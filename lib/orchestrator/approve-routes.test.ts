import fs from "fs";
import os from "os";
import path from "path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DEVICE_HEADER, TRUST_HEADER } from "@/lib/security/auth";
import type { softAuthenticator as SoftAuth } from "@/lib/security/soft-authenticator";

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
const { ensureOrchestrator } = await import("./home");
const { seedWorkspace } = await import("./testing");
const { escalate } = await import("./escalate");
const { getAsk, openAsks, raiseAsk } = await import("./asks");
const { isPaused, setPaused } = await import("./pause");
const { raisePasskeyAsks } = await import("./passkey-asks");
const { TOOL_NAMES } = await import("./tool-names");
const { mintDevice, setDeviceCanApprove } =
  await import("@/lib/security/devices");
const { getPasskey } = await import("@/lib/security/passkeys");
const { softAuthenticator } = await import("@/lib/security/soft-authenticator");
const askRoute =
  await import("@/app/api/workspaces/[id]/orchestrator/asks/[askId]/route");
const pauseRoute =
  await import("@/app/api/workspaces/[id]/orchestrator/pause/route");
const optionsRoute = await import("@/app/api/presence/options/route");
const revokeRoute = await import("@/app/api/presence/passkeys/[id]/route");
const registerOptionsRoute =
  await import("@/app/api/presence/register/options/route");

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-approve-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});
beforeEach(() => {
  db.exec(`DELETE FROM passkeys; DELETE FROM presence_challenges;
    DELETE FROM settings WHERE key = 'passkeys_bootstrapped_at';`);
});

type Who = { via?: string; device?: string };
const LOOPBACK: Who = { via: "loopback" };

function request(url: string, body: object, who: Who, method = "POST") {
  return new NextRequest(`http://localhost:3011${url}`, {
    method,
    headers: {
      host: "localhost:3011",
      origin: "http://localhost:3011",
      "content-type": "application/json",
      ...(who.via && { [TRUST_HEADER]: who.via }),
      ...(who.device && { [DEVICE_HEADER]: who.device }),
    },
    body: JSON.stringify(body),
  });
}

function setup() {
  const ws = seedWorkspace();
  ensureOrchestrator(ws.workspace.id);
  const w = ws.workspace.id;
  const task = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(ws.task) as import("@/lib/db").Session;
  escalate(w, task, "ci", "no CI ran", "https://pr/7", "a".repeat(40));
  const gate = openAsks(w)[0];
  const answer = (body: object, who: Who = LOOPBACK) =>
    askRoute.POST(
      request(`/api/workspaces/${w}/orchestrator/asks/${gate.id}`, body, who),
      { params: Promise.resolve({ id: w, askId: String(gate.id) }) }
    );
  const pause = (body: object, who: Who = LOOPBACK) =>
    pauseRoute.POST(
      request(`/api/workspaces/${w}/orchestrator/pause`, body, who),
      { params: Promise.resolve({ id: w }) }
    );
  return { w, gate, answer, pause };
}

async function proof(
  key: ReturnType<typeof SoftAuth>,
  body: object,
  who: Who = LOOPBACK
) {
  const res = await optionsRoute.POST(
    request("/api/presence/options", body, who)
  );
  const { options } = (await res.json()) as {
    options: { challenge: string };
  };
  return key.assert(options.challenge);
}

describe("answering an ask needs a person", () => {
  it("refuses a loopback approval of a gate ask with no passkey assertion", async () => {
    const t = setup();
    softAuthenticator().register();
    const res = await t.answer({ action: "approve", binding: "a".repeat(40) });
    expect(res.status).toBe(403);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("open");
  });

  it("approves on an assertion bound to that ask at that commit", async () => {
    const t = setup();
    const key = softAuthenticator();
    key.register();
    const binding = "a".repeat(40);
    const assertion = await proof(key, {
      purpose: "approve",
      workspaceId: t.w,
      askId: t.gate.id,
      binding,
    });
    const res = await t.answer({ action: "approve", binding, assertion });
    expect(res.status).toBe(200);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("approved");
  });

  it("won't issue a challenge for a commit the ask isn't about any more", async () => {
    const t = setup();
    softAuthenticator().register();
    const res = await optionsRoute.POST(
      request(
        "/api/presence/options",
        {
          purpose: "approve",
          workspaceId: t.w,
          askId: t.gate.id,
          binding: "b".repeat(40),
        },
        LOOPBACK
      )
    );
    expect(res.status).toBe(403);
  });

  it("lets a trusted place decline or reply without a passkey, and no one else", async () => {
    const t = setup();
    expect((await t.answer({ action: "decline" }, {})).status).toBe(403);
    const phone = mintDevice("Phone").device;
    const asPhone = { via: "device", device: phone.id };
    expect((await t.answer({ action: "decline" }, asPhone)).status).toBe(403);
    setDeviceCanApprove(phone.id, true);
    expect((await t.answer({ action: "decline" }, asPhone)).status).toBe(200);
    expect(getAsk(t.w, t.gate.id)?.status).toBe("declined");
  });

  it("approves a plain decision without a passkey, but must name it", async () => {
    const t = setup();
    const { ask } = raiseAsk({
      workspaceId: t.w,
      subject: "ask:name",
      kind: "decision",
      title: "Which name reads better?",
    });
    const call = (body: object) =>
      askRoute.POST(
        request(
          `/api/workspaces/${t.w}/orchestrator/asks/${ask.id}`,
          body,
          LOOPBACK
        ),
        { params: Promise.resolve({ id: t.w, askId: String(ask.id) }) }
      );
    expect((await call({ action: "approve" })).status).toBe(400);
    expect(
      (await call({ action: "approve", binding: "ask:name" })).status
    ).toBe(200);
  });
});

describe("Pause and Resume", () => {
  it("pauses from a trusted place, but resumes only on a passkey", async () => {
    const t = setup();
    const key = softAuthenticator();
    key.register();
    expect((await t.pause({ paused: true })).status).toBe(200);
    expect((await t.pause({ paused: false })).status).toBe(403);
    expect(isPaused(t.w)).toBe(true);
    const assertion = await proof(key, { purpose: "resume", workspaceId: t.w });
    expect((await t.pause({ paused: false, assertion })).status).toBe(200);
    expect(isPaused(t.w)).toBe(false);
    setPaused(t.w, false);
  });
});

describe("a new passkey", () => {
  it("lands on the asks list; declining it revokes it everywhere, with a passkey", async () => {
    const t = setup();
    const other = seedWorkspace();
    ensureOrchestrator(other.workspace.id);
    const key = softAuthenticator();
    const row = key.register("Mac");
    expect(raisePasskeyAsks(row, "this machine")).toBeGreaterThanOrEqual(2);
    const ask = openAsks(t.w).find((a) => a.kind === "passkey")!;
    expect(ask.title).toMatch(/^New passkey registered on this machine at /);
    const decline = (body: object) =>
      askRoute.POST(
        request(
          `/api/workspaces/${t.w}/orchestrator/asks/${ask.id}`,
          { action: "decline", binding: ask.subject, ...body },
          LOOPBACK
        ),
        { params: Promise.resolve({ id: t.w, askId: String(ask.id) }) }
      );
    // Declining revokes, and revoking needs a passkey: none, no revoke.
    expect((await decline({})).status).toBe(403);
    expect(getPasskey(key.id)?.revoked_at).toBeNull();
    const assertion = await proof(key, {
      purpose: "approve",
      workspaceId: t.w,
      askId: ask.id,
      binding: ask.subject,
    });
    expect((await decline({ assertion })).status).toBe(200);
    expect(getPasskey(key.id)?.revoked_at).toBeTruthy();
    expect(
      openAsks(other.workspace.id).filter((a) =>
        a.subject.startsWith("passkey:")
      )
    ).toEqual([]);
    // ...and the revoke itself is on the list.
    expect(openAsks(t.w).map((a) => a.title)).toContainEqual(
      expect.stringMatching(/^Passkey revoked on this machine at /)
    );
  });

  it("is never revoked without a passkey, the last one included", async () => {
    const t = setup();
    const a = softAuthenticator();
    const b = softAuthenticator();
    a.register();
    b.register();
    const revoke = (id: string, body: object, who: Who = LOOPBACK) =>
      revokeRoute.DELETE(
        request(`/api/presence/passkeys/${id}`, body, who, "DELETE"),
        { params: Promise.resolve({ id }) }
      );
    expect((await revoke(a.id, {})).status).toBe(403);
    const assertion = await proof(a, { purpose: "revoke", passkeyId: a.id });
    expect((await revoke(a.id, { assertion })).status).toBe(200);
    expect(openAsks(t.w).map((x) => x.title)).toContainEqual(
      expect.stringMatching(/^Passkey revoked on /)
    );
    // The last one, from this machine: still needs the passkey.
    expect((await revoke(b.id, {})).status).toBe(403);
    expect(getPasskey(b.id)?.revoked_at).toBeNull();
    const last = await proof(b, { purpose: "revoke", passkeyId: b.id });
    expect((await revoke(b.id, { assertion: last })).status).toBe(200);
    // And with none left, the first-use registration stays shut.
    const reg = await registerOptionsRoute.POST(
      request("/api/presence/register/options", {}, LOOPBACK)
    );
    expect(reg.status).toBe(403);
  });
});

describe("agents have no way to approve", () => {
  it("gives the orchestrator no tool to answer an ask or resume", () => {
    expect(Object.keys(TOOL_NAMES)).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/approve|answer|resume|pause/),
      ])
    );
  });

  it("has no aos command that reaches the ask, pause or passkey routes", () => {
    const aos = fs.readFileSync(path.join(process.cwd(), "bin/aos"), "utf8");
    expect(aos).not.toMatch(/orchestrator\/(asks|pause)|\/api\/presence/);
  });
});
