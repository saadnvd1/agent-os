import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEVICE_HEADER, TRUST_HEADER } from "@/lib/security/auth";
import { createSchema } from "@/lib/db/schema";
import { runMigrations } from "@/lib/db/migrations";

vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => true,
    getStatus: async () => "idle",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    capturePane: async () => "",
  },
}));

const { db } = await import("@/lib/db");
const { ensureOrchestrator } = await import("@/lib/orchestrator/home");
const { seedWorkspace } = await import("@/lib/orchestrator/testing");
const { escalate } = await import("@/lib/orchestrator/escalate");
const { getAsk, openAsks, raiseAsk } = await import("@/lib/orchestrator/asks");
const { isPaused, setPaused } = await import("@/lib/orchestrator/pause");
const { revokeDeviceAndKeys } = await import("@/lib/orchestrator/passkey-asks");
const { setNoApprovals } = await import("@/lib/approvals/no-approvals");
const { mintDevice, setDeviceCanApprove } =
  await import("@/lib/security/devices");
const { getPasskey } = await import("@/lib/security/passkeys");
const { mintEnrollCode } = await import("@/lib/security/presence");
const { softDeviceKey, softAuthenticator } =
  await import("@/lib/security/soft-authenticator");
const askRoute =
  await import("@/app/api/workspaces/[id]/orchestrator/asks/[askId]/route");
const pauseRoute =
  await import("@/app/api/workspaces/[id]/orchestrator/pause/route");
const optionsRoute = await import("@/app/api/presence/options/route");
const revokeRoute = await import("@/app/api/presence/passkeys/[id]/route");
const keyOptionsRoute =
  await import("@/app/api/presence/device-key/options/route");
const keyRoute = await import("@/app/api/presence/device-key/route");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-device-keys-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  setNoApprovals(false);
  db.exec(`DELETE FROM passkeys; DELETE FROM presence_challenges;
    DELETE FROM passkey_enrollments;
    DELETE FROM settings WHERE key = 'passkeys_bootstrapped_at';`);
});

type Who = { via: string; device?: string };
const BINDING = "a".repeat(40);

function request(url: string, body: object, who: Who) {
  return new NextRequest(`http://localhost:3011${url}`, {
    method: "POST",
    headers: {
      host: "localhost:3011",
      // Only the browser path reads it; the app sends none, and a device
      // key never looks.
      origin: "http://localhost:3011",
      "content-type": "application/json",
      [TRUST_HEADER]: who.via,
      ...(who.device && { [DEVICE_HEADER]: who.device }),
    },
    body: JSON.stringify(body),
  });
}

const phone = (name = "phone") => {
  const id = mintDevice(name).device.id;
  setDeviceCanApprove(id, true);
  return { via: "device", device: id } as Who;
};

// Registers a key for the device, as the app does.
async function register(who: Who, enrollCode?: string) {
  const key = softDeviceKey();
  const optionsRes = await keyOptionsRoute.POST(
    request("/api/presence/device-key/options", { enrollCode }, who)
  );
  const options = (await optionsRes.json()) as {
    challenge?: string;
    message?: string;
    needsCode?: boolean;
  };
  if (!options.challenge) return { key, optionsRes, options, res: null };
  const res = await keyRoute.POST(
    request(
      "/api/presence/device-key",
      {
        publicKey: key.publicKey,
        challenge: options.challenge,
        signature: key.sign(options.message!),
        name: "Saad's phone",
        hardware: "secure-enclave",
        enrollCode,
      },
      who
    )
  );
  return { key, optionsRes, options, res };
}

function setup() {
  const ws = seedWorkspace();
  ensureOrchestrator(ws.workspace.id);
  const w = ws.workspace.id;
  const task = db
    .prepare(`SELECT * FROM session_rows WHERE id = ?`)
    .get(ws.task) as import("@/lib/db").Session;
  escalate(w, task, "ci", "no CI ran", "https://pr/7", BINDING);
  const gate = openAsks(w)[0];
  const answer = (body: object, who: Who) =>
    askRoute.POST(
      request(`/api/workspaces/${w}/orchestrator/asks/${gate.id}`, body, who),
      { params: Promise.resolve({ id: w, askId: String(gate.id) }) }
    );
  const pause = (body: object, who: Who) =>
    pauseRoute.POST(
      request(`/api/workspaces/${w}/orchestrator/pause`, body, who),
      {
        params: Promise.resolve({ id: w }),
      }
    );
  return { w, gate, answer, pause };
}

interface Signed {
  deviceSignature: { keyId: string; challenge: string; signature: string };
}

async function sign(
  key: ReturnType<typeof softDeviceKey>,
  body: object,
  who: Who
): Promise<Signed> {
  const res = await optionsRoute.POST(
    request("/api/presence/options", { ...body, method: "device" }, who)
  );
  const { device } = (await res.json()) as {
    device: { challenge: string; keyId: string; message: string };
  };
  return {
    deviceSignature: {
      keyId: device.keyId,
      challenge: device.challenge,
      signature: key.sign(device.message),
    },
  };
}

describe("registering a device key", () => {
  it("is free for the first key, stored by public key, and goes on the asks list", async () => {
    const t = setup();
    const who = phone();
    const { res } = await register(who);
    expect(res?.status).toBe(200);
    const { passkey } = (await res!.json()) as { passkey: { id: string } };
    const row = getPasskey(passkey.id)!;
    expect(row.type).toBe("device");
    expect(row.device_id).toBe(who.device);
    expect(row.rp_id).toBe(`device:${who.device}`);
    expect(
      openAsks(t.w).some((a) => a.subject === `passkey:${passkey.id}`)
    ).toBe(true);
  });

  it("then needs a code from an existing passkey, spent once", async () => {
    setup();
    await register(phone("first"));
    const second = phone("second");
    const no = await register(second);
    expect(no.options.needsCode).toBe(true);
    const code = mintEnrollCode();
    const ok = await register(second, code);
    expect(ok.res?.status).toBe(200);
    const again = await register(phone("third"), code);
    // A spent code is no code.
    expect(again.options.needsCode).toBe(true);
    expect(again.res).toBeNull();
  });

  it("refuses a key that can't sign its own registration", async () => {
    setup();
    const who = phone();
    const key = softDeviceKey();
    const other = softDeviceKey();
    const o = (await (
      await keyOptionsRoute.POST(
        request("/api/presence/device-key/options", {}, who)
      )
    ).json()) as { challenge: string; message: string };
    const res = await keyRoute.POST(
      request(
        "/api/presence/device-key",
        {
          publicKey: key.publicKey,
          challenge: o.challenge,
          signature: other.sign(o.message),
        },
        who
      )
    );
    expect(res.status).toBe(403);
    expect(db.prepare(`SELECT COUNT(*) n FROM passkeys`).get()).toEqual({
      n: 0,
    });
  });

  it("is for a paired device only, not this machine or the tailnet", async () => {
    setup();
    for (const via of ["loopback", "tailnet"]) {
      const res = await keyOptionsRoute.POST(
        request("/api/presence/device-key/options", {}, { via })
      );
      expect(res.status).toBe(403);
    }
  });

  it("replaces the device's old key when it registers again", async () => {
    const t = setup();
    const who = phone();
    const first = await register(who);
    const { passkey } = (await first.res!.json()) as {
      passkey: { id: string };
    };
    const code = mintEnrollCode();
    const second = await register(who, code);
    expect(second.res?.status).toBe(200);
    expect(getPasskey(passkey.id)?.revoked_at).toBeTruthy();
    expect(
      openAsks(t.w).some((a) => a.subject === `passkey-revoked:${passkey.id}`)
    ).toBe(true);
  });
});

describe("approving with a device key", () => {
  it("approves a hard-line ask on a signature bound to that ask and commit", async () => {
    const t = setup();
    const who = phone();
    const { key } = await register(who);
    const proof = await sign(
      key,
      {
        purpose: "approve",
        workspaceId: t.w,
        askId: t.gate.id,
        binding: BINDING,
      },
      who
    );
    const res = await t.answer(
      { action: "approve", binding: BINDING, ...proof },
      who
    );
    expect(res.status).toBe(200);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("approved");
    expect(getPasskey(proof.deviceSignature.keyId)?.last_used_at).toBeTruthy();
  });

  it("refuses with no signature", async () => {
    const t = setup();
    const who = phone();
    await register(who);
    const res = await t.answer({ action: "approve", binding: BINDING }, who);
    expect(res.status).toBe(403);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("open");
  });

  it("approves only the ask it was made for", async () => {
    const t = setup();
    const who = phone();
    const { key } = await register(who);
    const other = raiseAsk({
      workspaceId: t.w,
      subject: "money-thing",
      kind: "money",
      title: "Spend it",
      detail: "x",
    }).ask;
    const proof = await sign(
      key,
      {
        purpose: "approve",
        workspaceId: t.w,
        askId: other.id,
        binding: other.subject,
      },
      who
    );
    const res = await t.answer(
      { action: "approve", binding: BINDING, ...proof },
      who
    );
    expect(res.status).toBe(403);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("open");
    expect(getAsk(t.w, other.id)?.status).toBe("open");
  });

  it("refuses a signature for another purpose", async () => {
    const t = setup();
    const who = phone();
    const { key } = await register(who);
    setPaused(t.w, true);
    const proof = await sign(key, { purpose: "resume", workspaceId: t.w }, who);
    const res = await t.answer(
      { action: "approve", binding: BINDING, ...proof },
      who
    );
    expect(res.status).toBe(403);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("open");
  });

  it("can't be replayed", async () => {
    const t = setup();
    const who = phone();
    const { key } = await register(who);
    setPaused(t.w, true);
    const proof = await sign(key, { purpose: "resume", workspaceId: t.w }, who);
    expect((await t.pause({ paused: false, ...proof }, who)).status).toBe(200);
    expect(isPaused(t.w)).toBe(false);
    setPaused(t.w, true);
    expect((await t.pause({ paused: false, ...proof }, who)).status).toBe(403);
    expect(isPaused(t.w)).toBe(true);
  });

  it("spends the challenge on a bad signature, so there's one try", async () => {
    const t = setup();
    const who = phone();
    const { key } = await register(who);
    const body = {
      purpose: "approve",
      workspaceId: t.w,
      askId: t.gate.id,
      binding: BINDING,
    };
    const good = await sign(key, body, who);
    const bad = {
      deviceSignature: {
        ...good.deviceSignature,
        signature: softDeviceKey().sign("something else"),
      },
    };
    expect(
      (await t.answer({ action: "approve", binding: BINDING, ...bad }, who))
        .status
    ).toBe(403);
    expect(
      (await t.answer({ action: "approve", binding: BINDING, ...good }, who))
        .status
    ).toBe(403);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("open");
  });

  it("refuses an expired challenge", async () => {
    const t = setup();
    const who = phone();
    const { key } = await register(who);
    const proof = await sign(
      key,
      {
        purpose: "approve",
        workspaceId: t.w,
        askId: t.gate.id,
        binding: BINDING,
      },
      who
    );
    db.prepare(`UPDATE presence_challenges SET expires_at = 1`).run();
    const res = await t.answer(
      { action: "approve", binding: BINDING, ...proof },
      who
    );
    expect(res.status).toBe(403);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("open");
  });

  it("refuses another device presenting this device's key", async () => {
    const t = setup();
    const a = phone("a");
    const b = phone("b");
    const { key } = await register(a);
    const proof = await sign(
      key,
      {
        purpose: "approve",
        workspaceId: t.w,
        askId: t.gate.id,
        binding: BINDING,
      },
      a
    );
    const res = await t.answer(
      { action: "approve", binding: BINDING, ...proof },
      b
    );
    expect(res.status).toBe(403);
    // And b has no key of its own to ask options with.
    const o = await optionsRoute.POST(
      request(
        "/api/presence/options",
        { purpose: "resume", workspaceId: t.w, method: "device" },
        b
      )
    );
    expect(await o.json()).toMatchObject({ needsDeviceKey: true });
  });

  it("refuses a device key from this machine or the tailnet", async () => {
    const t = setup();
    const who = phone();
    const { key } = await register(who);
    const proof = await sign(
      key,
      {
        purpose: "approve",
        workspaceId: t.w,
        askId: t.gate.id,
        binding: BINDING,
      },
      who
    );
    const res = await t.answer(
      { action: "approve", binding: BINDING, ...proof },
      { via: "loopback" }
    );
    expect(res.status).toBe(403);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("open");
  });

  it("refuses once the key is revoked, with a passkey, and the revoke is noted", async () => {
    const t = setup();
    const who = phone();
    const { key } = await register(who);
    const proof = await sign(
      key,
      {
        purpose: "approve",
        workspaceId: t.w,
        askId: t.gate.id,
        binding: BINDING,
      },
      who
    );
    const keyId = proof.deviceSignature.keyId;
    // Revoking takes a proof too: the device's own here.
    const revokeProof = await sign(
      key,
      { purpose: "revoke", passkeyId: keyId },
      who
    );
    const rev = await revokeRoute.DELETE(
      request(`/api/presence/passkeys/${keyId}`, revokeProof, who),
      { params: Promise.resolve({ id: keyId }) }
    );
    expect(rev.status).toBe(200);
    expect(getPasskey(keyId)?.revoked_at).toBeTruthy();
    const res = await t.answer(
      { action: "approve", binding: BINDING, ...proof },
      who
    );
    expect(res.status).toBe(403);
    const o = await optionsRoute.POST(
      request(
        "/api/presence/options",
        { purpose: "resume", workspaceId: t.w, method: "device" },
        who
      )
    );
    expect(await o.json()).toMatchObject({ needsDeviceKey: true });
  });

  it("refuses once the device is revoked, and its key goes with it", async () => {
    const t = setup();
    const who = phone();
    const { key } = await register(who);
    const proof = await sign(
      key,
      {
        purpose: "approve",
        workspaceId: t.w,
        askId: t.gate.id,
        binding: BINDING,
      },
      who
    );
    const keyId = proof.deviceSignature.keyId;
    expect(revokeDeviceAndKeys(who.device!, "Devices")).toBe(true);
    expect(getPasskey(keyId)?.revoked_at).toBeTruthy();
    expect(
      openAsks(t.w).some((a) => a.subject === `passkey-revoked:${keyId}`)
    ).toBe(true);
    const res = await t.answer(
      { action: "approve", binding: BINDING, ...proof },
      who
    );
    expect(res.status).toBe(403);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("open");
  });

  it("leaves a browser passkey working as before", async () => {
    const t = setup();
    const web = softAuthenticator();
    web.register();
    const res = await optionsRoute.POST(
      request(
        "/api/presence/options",
        {
          purpose: "approve",
          workspaceId: t.w,
          askId: t.gate.id,
          binding: BINDING,
        },
        { via: "loopback" }
      )
    );
    expect(res.status).toBe(200);
  });
});

describe("No approvals mode", () => {
  it("approves asks as raised with no signature at all", () => {
    const t = setup();
    setNoApprovals(true);
    const { ask } = raiseAsk({
      workspaceId: t.w,
      subject: "money-two",
      kind: "money",
      title: "Spend more",
      detail: "x",
    });
    expect(ask.status).toBe("approved");
  });

  it("changes nothing for an ask still open: it still needs the key", async () => {
    const t = setup();
    const who = phone();
    await register(who);
    setNoApprovals(true);
    const res = await t.answer({ action: "approve", binding: BINDING }, who);
    expect(res.status).toBe(403);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("open");
  });
});

describe("migration 89 (passkeys_device_keys)", () => {
  it("adds the columns and reads old keys as browser passkeys", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "device-keys-mig-"));
    const old = new Database(path.join(dir, "old.db"));
    createSchema(old);
    runMigrations(old, 87);
    old
      .prepare(
        `INSERT INTO passkeys (id, public_key, rp_id, name) VALUES ('k', x'00', 'localhost', 'Mac')`
      )
      .run();
    runMigrations(old);
    expect(
      old.prepare(`SELECT type, device_id FROM passkeys WHERE id = 'k'`).get()
    ).toEqual({ type: "webauthn", device_id: null });
  });
});
