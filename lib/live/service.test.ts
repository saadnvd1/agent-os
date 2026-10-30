import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "@/lib/test-temp";

const sent = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/chat/runner", () => ({
  sendChatConfirmed: vi.fn(async (...a: unknown[]) => {
    sent.calls.push(a);
    return "delivered";
  }),
}));

const dir = tempDir("agentos-live-");
const keys = crypto.generateKeyPairSync("ed25519");
const MACHINE = "abcd1234";
const seen: { method: string; url: string; body: string }[] = [];
let mintStatus = 201;
let connectCodes = true;
let putStatus = 200;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ method: req.method!, url: req.url!, body });
    if (req.method === "PUT" && req.url!.endsWith("/access-code")) {
      const c = JSON.parse(body).access_code;
      return res
        .writeHead(putStatus, { "Content-Type": "application/json" })
        .end(
          JSON.stringify(
            putStatus === 200 ? { access_code: c !== null } : { error: "no" }
          )
        );
    }
    if (req.method === "POST" && req.url!.endsWith("/live-shares"))
      return res
        .writeHead(mintStatus, { "Content-Type": "application/json" })
        .end(
          JSON.stringify(
            mintStatus === 201
              ? {
                  id: "live00000001",
                  url: "https://runagentos.com/s/tok",
                  title: "Pairing",
                  status: "active",
                  expires_at: new Date(Date.now() + 3600_000).toISOString(),
                  ends_with_session: false,
                  max_guests: 5,
                  ...(connectCodes && JSON.parse(body).access_code
                    ? { access_code: true }
                    : {}),
                }
              : { error: "Free plans get 1 live share at a time." }
          )
        );
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ id: "live00000001", status: "revoked" }));
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.AGENTOS_CONNECT_DIR = dir;
fs.writeFileSync(
  path.join(dir, "connect.json"),
  JSON.stringify({
    machineId: MACHINE,
    hostname: "m-0123456789abcdef.runagentos.com",
    apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    enabled: true,
  }),
  { mode: 0o600 }
);
fs.writeFileSync(
  path.join(dir, "machine.key"),
  keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  { mode: 0o600 }
);

const { live } = await import("./runtime");
const svc = await import("./service");
const { saveItem } = await import("@/lib/chat/store");
const { seedSession } = await import("@/lib/orchestrator/testing");
const { createProject } = await import("@/lib/projects");
const { getDb } = await import("@/lib/db");
const { listLog } = await import("./store");
const { droppedCount } = await import("./inbox");

interface Fake {
  url: string;
  headers: Record<string, string>;
  out: Record<string, unknown>[];
  readyState: number;
  handlers: Record<string, (d?: unknown) => void>;
}
let fakes: Fake[] = [];
const factory = (url: string, headers: Record<string, string>) => {
  const f: Fake = { url, headers, out: [], readyState: 1, handlers: {} };
  fakes.push(f);
  return {
    get readyState() {
      return f.readyState;
    },
    send: (d: string) => f.out.push(JSON.parse(d)),
    close: () => {},
    terminate: () => {
      f.readyState = 3;
    },
    on: (e: string, fn: (d?: unknown) => void) => {
      f.handlers[e] = fn;
    },
  };
};
const SHARE = "live00000001";
const ident = JSON.stringify({ channel: "LiveHostChannel", share_id: SHARE });
const down = (frame: Record<string, unknown>) =>
  fakes.at(-1)!.handlers.message(
    JSON.stringify({
      identifier: ident,
      message: { share_id: SHARE, ...frame },
    })
  );
const actions = (type = "message") =>
  fakes
    .at(-1)!
    .out.filter((m) => m.command === type)
    .map((m) => JSON.parse(m.data as string) as Record<string, unknown>);

function chat() {
  const project = createProject({
    name: `p-${randomUUID().slice(0, 6)}`,
    workingDirectory: "/tmp/p",
  });
  const id = seedSession({
    projectId: project.id,
    name: "Pairing",
    view: "chat",
  });
  let t = 0;
  const add = (i: Record<string, unknown>) =>
    saveItem(id, { createdAt: ++t, ...i } as never);
  add({ id: "u1", kind: "user", text: "hello" });
  add({ id: "r1", kind: "reasoning", text: "private thoughts" });
  add({ id: "a1", kind: "assistant", text: "hi there" });
  return id;
}

let session = "";
async function open(level: "watch" | "suggest" = "suggest", history = true) {
  session = chat();
  const view = await svc.createLive(session, "1h", level, history);
  const f = fakes.at(-1)!;
  f.handlers.message(JSON.stringify({ type: "welcome" }));
  f.handlers.message(
    JSON.stringify({ type: "confirm_subscription", identifier: ident })
  );
  return view;
}

async function joinAndAdmit(gid = "g1", name = "Ahmed") {
  down({ type: "join_request", guest: { id: gid, name } });
  svc.admit(SHARE, gid);
  down({ type: "presence", guest: { id: gid, name }, online: true });
}

beforeEach(() => {
  for (const id of [...live.runtimes.keys()]) live.runtimes.delete(id);
  live.socket?.close();
  live.socket = svc.makeSocket(factory as never);
  fakes = [];
  seen.length = 0;
  sent.calls = [];
  mintStatus = 201;
  connectCodes = true;
  putStatus = 200;
  getDb().prepare(`DELETE FROM live_shares`).run();
  getDb().prepare(`DELETE FROM live_share_log`).run();
});

afterAll(() => {
  live.socket?.close();
  server.close();
});

describe("starting a live share", () => {
  it("mints on Connect, opens a signed socket without an Origin, and subscribes", async () => {
    const view = await open();
    expect(view.url).toBe("https://runagentos.com/s/tok");
    expect(JSON.parse(seen[0].body)).toEqual({
      title: "Pairing",
      expires_in: "1h",
      access: "suggest",
    });
    const f = fakes[0];
    expect(f.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/cable$/);
    expect(Object.keys(f.headers).sort()).toEqual([
      "X-Connect-Machine",
      "X-Connect-Nonce",
      "X-Connect-Signature",
      "X-Connect-Timestamp",
    ]);
    const msg = [
      "agentos-connect-api",
      "GET",
      "/cable",
      f.headers["X-Connect-Timestamp"],
      f.headers["X-Connect-Nonce"],
      crypto.createHash("sha256").update("").digest("hex"),
    ].join("\n");
    expect(
      crypto.verify(
        null,
        Buffer.from(msg),
        keys.publicKey,
        Buffer.from(f.headers["X-Connect-Signature"], "base64url")
      )
    ).toBe(true);
    expect(f.out.some((m) => m.command === "subscribe")).toBe(true);
  });

  it("refuses a second link for the same session and reports a plan limit", async () => {
    await open();
    await expect(svc.createLive(session, "1h")).rejects.toMatchObject({
      status: 409,
    });
    mintStatus = 402;
    await expect(svc.createLive(chat(), "1h")).rejects.toMatchObject({
      status: 402,
    });
  });
});

describe("guests", () => {
  it("puts a request in the lobby, flags a duplicate name, and admits on tap", async () => {
    await open();
    down({ type: "join_request", guest: { id: "g1", name: "Ahmed" } });
    down({ type: "join_request", guest: { id: "g2", name: "ahmed" } });
    const v = svc.viewOf(SHARE)!;
    expect(v.guests.map((g) => [g.name, g.status, g.duplicateName])).toEqual([
      ["Ahmed", "pending", true],
      ["ahmed", "pending", true],
    ]);
    expect(actions().some((a) => a.action === "admit")).toBe(false);
    svc.admit(SHARE, "g1");
    expect(actions().filter((a) => a.action === "admit")).toEqual([
      { action: "admit", guest_id: "g1" },
    ]);
    expect(listLog(SHARE).map((l) => l.kind)).toEqual([
      "join_request",
      "join_request",
      "admit",
    ]);
  });

  it("caps the lobby when a roster frame lists many pending guests", async () => {
    await open();
    down({
      type: "roster",
      guests: Array.from({ length: 60 }, (_, i) => ({
        id: `r${i}`,
        name: `Guest ${i}`,
        status: "pending",
      })),
    });
    expect(svc.viewOf(SHARE)!.guests).toHaveLength(10);
  });

  it("logs one join request per guest however often it repeats", async () => {
    await open();
    for (let i = 0; i < 3; i++) {
      down({ type: "join_request", guest: { id: "g1", name: "Ahmed" } });
      down({ type: "guest_left", guest: { id: "g1", name: "Ahmed" } });
    }
    expect(
      listLog(SHARE).filter((l) => l.kind === "join_request")
    ).toHaveLength(1);
  });

  it("a refused admit can never come back admitted from a later roster", async () => {
    await open();
    down({ type: "join_request", guest: { id: "g1", name: "Ahmed" } });
    svc.admit(SHARE, "g1");
    down({ type: "admit_failed", guest_id: "g1", reason: "limit" });
    expect(svc.viewOf(SHARE)!.guests[0].status).toBe("pending");
    down({
      type: "roster",
      guests: [{ id: "g1", name: "Ahmed", status: "admitted" }],
    });
    expect(svc.viewOf(SHARE)!.guests[0].status).toBe("pending");
  });

  it("cleans a guest's name again", async () => {
    await open();
    down({ type: "join_request", guest: { id: "g1", name: "Ah‮med​" } });
    expect(svc.viewOf(SHARE)!.guests[0].name).toBe("Ahmed");
    down({ type: "join_request", guest: { id: "g2", name: "​" } });
    expect(svc.viewOf(SHARE)!.guests).toHaveLength(1);
  });

  it("sends catch-up of guest-visible items only, once the guest is online", async () => {
    await open();
    await joinAndAdmit();
    const [catchup] = actions().filter((a) => a.action === "catchup");
    expect(catchup.guest_id).toBe("g1");
    const text = JSON.stringify(catchup.items);
    expect(text).toContain("hello");
    expect(text).toContain("hi there");
    expect(text).not.toContain("private thoughts");
  });

  it("ignores presence and suggestions from a guest it did not admit", async () => {
    await open();
    down({ type: "join_request", guest: { id: "g1", name: "Ahmed" } });
    down({
      type: "presence",
      guest: { id: "g1", name: "Ahmed" },
      online: true,
    });
    expect(actions().some((a) => a.action === "catchup")).toBe(false);
    down({
      type: "suggestion",
      id: "s1",
      guest: { id: "g1", name: "Ahmed" },
      text: "rm -rf",
    });
    down({
      type: "suggestion",
      id: "s2",
      guest: { id: "nobody", name: "Eve" },
      text: "x",
    });
    expect(svc.viewOf(SHARE)!.suggestions).toEqual([]);
  });

  it("denies and kicks, and a kicked guest is no longer admitted", async () => {
    await open();
    down({ type: "join_request", guest: { id: "g1", name: "Ahmed" } });
    svc.deny(SHARE, "g1");
    expect(actions().some((a) => a.action === "deny")).toBe(true);
    await joinAndAdmit("g2", "Sara");
    svc.kick(SHARE, "g2");
    expect(svc.viewOf(SHARE)!.guests).toEqual([]);
    down({
      type: "suggestion",
      id: "s9",
      guest: { id: "g2", name: "Sara" },
      text: "hi",
    });
    expect(svc.viewOf(SHARE)!.suggestions).toEqual([]);
  });
});

describe("the downward allowlist", () => {
  it("drops unknown types, another share's frames, and bad shapes", async () => {
    await open();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    down({ type: "run", command: "rm -rf /" });
    down({ type: "execute", text: "x" });
    down({
      type: "join_request",
      share_id: "other0000001",
      guest: { id: "g1", name: "Ahmed" },
    });
    down({ type: "join_request", guest: { id: "", name: "x" } });
    down({ type: "join_request" });
    expect(svc.viewOf(SHARE)!.guests).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(5);
    warn.mockRestore();
  });

  it("ignores a frame for a share this machine does not hold", async () => {
    await open();
    const { handleFrame } = await import("./inbox");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const used = handleFrame(
      "unknown00001",
      { type: "join_request", guest: { id: "g1", name: "A" } },
      { send: () => {}, ended: () => {} }
    );
    expect(used).toBe(false);
    warn.mockRestore();
  });
});

describe("suggestions", () => {
  async function card(text = "run the tests") {
    await joinAndAdmit();
    down({
      type: "suggestion",
      id: "s1",
      guest: { id: "g1", name: "Ahmed" },
      text,
    });
  }

  it("stays a card: nothing reaches the agent until the host sends it", async () => {
    await open();
    await card("do‮ it");
    expect(svc.viewOf(SHARE)!.suggestions).toMatchObject([
      { id: "s1", guestName: "Ahmed", text: "do it" },
    ]);
    expect(sent.calls).toHaveLength(0);
    svc.dismissSuggestion(SHARE, "s1");
    expect(sent.calls).toHaveLength(0);
    expect(svc.viewOf(SHARE)!.suggestions).toEqual([]);
    expect(actions().at(-1)).toEqual({
      action: "suggestion_status",
      guest_id: "g1",
      id: "s1",
      status: "dismissed",
    });
  });

  it("sends the cleaned (and edited) text once, as the host's message from the guest", async () => {
    await open();
    await card();
    await svc.sendSuggestion(SHARE, "s1", "run the tests​ please");
    expect(sent.calls).toHaveLength(1);
    expect(sent.calls[0][0]).toBe(session);
    expect(sent.calls[0][1]).toEqual({
      text: "run the tests please",
      origin: { kind: "guest", label: "Ahmed" },
      // The host's own tap: it ends a guest's steer, as their typing would.
      host: true,
    });
    expect(actions().at(-1)).toMatchObject({ status: "sent" });
    const log = listLog(SHARE).find((l) => l.kind === "sent")!;
    expect(log.sent_text).toBe("run the tests please");
    await expect(svc.sendSuggestion(SHARE, "s1")).rejects.toMatchObject({
      status: 404,
    });
    expect(sent.calls).toHaveLength(1);
  });

  it("★ sends a suggestion's @ as ＠, so a path in it attaches no file", async () => {
    await open();
    await card("look at @~/.config/tokenvault/master.key");
    await svc.sendSuggestion(SHARE, "s1");
    // Edited by the host or not, it began as the guest's text.
    down({
      type: "suggestion",
      id: "s2",
      guest: { id: "g1", name: "Ahmed" },
      text: "again @.env",
    });
    await svc.sendSuggestion(SHARE, "s2", "now @.env please");
    const texts = sent.calls.map((c) => (c[1] as { text: string }).text);
    expect(texts).toEqual([
      "look at \uff20~/.config/tokenvault/master.key",
      "now \uff20.env please",
    ]);
    expect(texts.join("")).not.toContain("@");
  });

  it("drops a second suggestion with an id already used, so Send is unambiguous", async () => {
    await open();
    await card("first text");
    down({
      type: "suggestion",
      id: "s1",
      guest: { id: "g1", name: "Ahmed" },
      text: "second text",
    });
    expect(svc.viewOf(SHARE)!.suggestions).toMatchObject([
      { id: "s1", text: "first text" },
    ]);
    await svc.sendSuggestion(SHARE, "s1");
    down({
      type: "suggestion",
      id: "s1",
      guest: { id: "g1", name: "Ahmed" },
      text: "after send",
    });
    expect(svc.viewOf(SHARE)!.suggestions).toEqual([]);
  });

  it("keeps the card when the send fails", async () => {
    await open();
    await card();
    const runner = await import("@/lib/chat/runner");
    vi.mocked(runner.sendChatConfirmed).mockRejectedValueOnce(
      new Error("busy")
    );
    await expect(svc.sendSuggestion(SHARE, "s1")).rejects.toThrow();
    expect(svc.viewOf(SHARE)!.suggestions).toHaveLength(1);
  });

  it("caps open cards at 20 and tells the guest the rest were dismissed", async () => {
    await open();
    await joinAndAdmit();
    for (let i = 0; i < 22; i++)
      down({
        type: "suggestion",
        id: `s${i}`,
        guest: { id: "g1", name: "Ahmed" },
        text: `idea ${i}`,
      });
    expect(svc.viewOf(SHARE)!.suggestions).toHaveLength(20);
    const refused = actions().filter(
      (a) => a.action === "suggestion_status" && a.status === "dismissed"
    );
    expect(refused.map((a) => a.id)).toEqual(["s20", "s21"]);
  });

  it("drops empty or invisible-only suggestions", async () => {
    await open();
    await joinAndAdmit();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    down({
      type: "suggestion",
      id: "s1",
      guest: { id: "g1", name: "Ahmed" },
      text: "​‮",
    });
    expect(svc.viewOf(SHARE)!.suggestions).toEqual([]);
    warn.mockRestore();
  });
});

describe("ending", () => {
  it("revokes on Connect, drops the subscription and forgets the share", async () => {
    await open();
    await svc.endLive(SHARE);
    expect(seen.at(-1)).toMatchObject({
      method: "DELETE",
      url: `/api/v1/machines/${MACHINE}/shares/${SHARE}`,
    });
    expect(svc.viewOf(SHARE)).toBeNull();
    expect(svc.listLive()).toEqual([]);
    expect(fakes[0].out.some((m) => m.command === "unsubscribe")).toBe(true);
  });

  it("stops when Connect says the share ended", async () => {
    await open();
    down({ type: "ended" });
    expect(svc.viewOf(SHARE)).toBeNull();
  });
});

describe("access levels", () => {
  const suggestion = () =>
    down({
      type: "suggestion",
      id: "s9",
      guest: { id: "g1", name: "Ahmed" },
      text: "run it",
    });

  it("forwards the level and history to Connect and stores them", async () => {
    const view = await open("watch", false);
    expect(JSON.parse(seen[0].body).access).toBe("watch");
    expect(view).toMatchObject({ level: "watch", history: false });
    expect(live.runtimes.get(SHARE)!.share).toMatchObject({
      level: "watch",
      history: 0,
    });
  });

  it("drops a forged suggestion under Watch: no card, no log row, counted", async () => {
    await open("watch");
    await joinAndAdmit();
    const before = droppedCount();
    const rows = listLog(SHARE).length;
    suggestion();
    expect(svc.viewOf(SHARE)!.suggestions).toEqual([]);
    expect(listLog(SHARE)).toHaveLength(rows);
    expect(droppedCount()).toBe(before + 1);
    expect(sent.calls).toHaveLength(0);
  });

  it("changeLevel logs, sends access up, and refuses unknown or unavailable levels", async () => {
    await open();
    svc.changeLevel(SHARE, "watch");
    expect(listLog(SHARE).at(-1)).toMatchObject({
      kind: "level",
      ref: "watch",
    });
    expect(actions().at(-1)).toEqual({ action: "access", level: "watch" });
    expect(svc.viewOf(SHARE)!.level).toBe("watch");
    expect(() => svc.changeLevel(SHARE, "bogus" as never)).toThrow(/Unknown/);
    expect(() => svc.changeLevel(SHARE, "drive")).toThrow(/isn't available/);
    expect(svc.viewOf(SHARE)!.level).toBe("watch");
  });

  it("Suggest to Watch keeps the cards already on screen", async () => {
    await open();
    await joinAndAdmit();
    suggestion();
    svc.changeLevel(SHARE, "watch");
    expect(svc.viewOf(SHARE)!.suggestions).toHaveLength(1);
    await svc.sendSuggestion(SHARE, "s9");
    expect(sent.calls).toHaveLength(1);
  });

  it("serves the invite options with the earlier-message count", async () => {
    const id = chat();
    const invite = svc.inviteFor(id);
    expect(invite.history).toMatchObject({
      default: true,
      count: 2,
      label: "Include the 2 earlier messages",
    });
    expect(invite.levels.map((l) => [l.value, l.enabled])).toEqual([
      ["watch", true],
      ["suggest", true],
      ["drive", false],
    ]);
  });
});

describe("the access code", () => {
  async function openWith(code: { custom?: string } | null) {
    session = chat();
    await svc.createLive(session, "1h", "suggest", true, code);
    const f = fakes.at(-1)!;
    f.handlers.message(JSON.stringify({ type: "welcome" }));
    f.handlers.message(
      JSON.stringify({ type: "confirm_subscription", identifier: ident })
    );
  }
  const view = () => svc.viewOf(SHARE)!;

  it("is off by default: nothing sent to Connect, only Turn on offered", async () => {
    await openWith(null);
    expect(JSON.parse(seen[0].body)).not.toHaveProperty("access_code");
    expect(view().code.on).toBe(false);
    expect(view().code.actions.map((a) => a.kind)).toEqual(["code_on"]);
    expect(svc.inviteFor(session).code.default).toBe(false);
  });

  it("generates a six-digit code at create and sends it with the mint", async () => {
    await openWith({});
    const sentCode = JSON.parse(seen[0].body).access_code;
    expect(sentCode).toMatch(/^\d{6}$/);
    const c = view().code;
    expect(c.on).toBe(true);
    expect(c.display).toBe(`${sentCode.slice(0, 3)}-${sentCode.slice(3)}`);
    expect(c.copyText).toBe(
      `https://runagentos.com/s/tok\nAccess code: ${c.display}`
    );
    expect(c.actions.map((a) => a.kind)).toEqual([
      "copy",
      "copy_link",
      "new_code",
      "set_code",
      "code_off",
    ]);
  });

  it("uses the host's own code, and refuses a bad one before calling Connect", async () => {
    await openWith({ custom: "blue-42x" });
    expect(JSON.parse(seen[0].body).access_code).toBe("BLUE42X");
    expect(view().code.display).toBe("BLUE42X");
    seen.length = 0;
    await expect(
      svc.createLive(chat(), "1h", "suggest", true, { custom: "abc" })
    ).rejects.toMatchObject({ status: 400 });
    expect(seen).toHaveLength(0);
  });

  it("an old Connect leaves no share and throws", async () => {
    connectCodes = false;
    await expect(
      svc.createLive(chat(), "1h", "suggest", true, {})
    ).rejects.toThrow(/doesn't support access codes/);
    expect(seen.at(-1)).toMatchObject({ method: "DELETE" });
    expect(getDb().prepare(`SELECT * FROM live_shares`).all()).toHaveLength(0);
    expect(live.runtimes.size).toBe(0);
  });

  it("turns on, changes, sets its own and turns off, via Connect first", async () => {
    await openWith(null);
    await svc.changeCode(SHARE, { generate: true });
    const put = JSON.parse(seen.at(-1)!.body).access_code;
    expect(seen.at(-1)!.method).toBe("PUT");
    expect(put).toMatch(/^\d{6}$/);
    expect(view().code.on).toBe(true);
    await svc.changeCode(SHARE, { code: "my own 99" });
    expect(JSON.parse(seen.at(-1)!.body).access_code).toBe("MYOWN99");
    expect(view().code.display).toBe("MYOWN99");
    await svc.changeCode(SHARE, null);
    expect(JSON.parse(seen.at(-1)!.body).access_code).toBeNull();
    expect(view().code.on).toBe(false);
  });

  it("a failed PUT keeps the old code and says so", async () => {
    await openWith({ custom: "keep123" });
    putStatus = 500;
    await expect(svc.changeCode(SHARE, { generate: true })).rejects.toThrow(
      /didn't confirm/
    );
    expect(view().code.display).toBe("KEEP123");
    await expect(svc.changeCode(SHARE, { code: "x" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("a code change keeps admitted and lobby guests and kicks no one", async () => {
    await openWith({});
    await joinAndAdmit("g1", "Ahmed");
    down({ type: "join_request", guest: { id: "g2", name: "Sara" } });
    const before = fakes.at(-1)!.out.length;
    await svc.changeCode(SHARE, { generate: true });
    expect(view().guests.map((g) => [g.id, g.status])).toEqual([
      ["g1", "admitted"],
      ["g2", "pending"],
    ]);
    const frames = fakes
      .at(-1)!
      .out.slice(before)
      .map((m) => String(m.data));
    expect(frames.some((d) => /kick|deny/.test(d))).toBe(false);
  });

  it("code_locked sets the notice and a code change clears it", async () => {
    await openWith({});
    down({
      type: "code_locked",
      until: new Date(Date.now() + 600_000).toISOString(),
    });
    expect(view().code.notice).toMatch(/Too many wrong codes/);
    await svc.changeCode(SHARE, { generate: true });
    expect(view().code.notice).toBeNull();
  });

  it("never writes the code to the console or the log", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m)
    );
    await openWith({ custom: "secret77" });
    await svc.changeCode(SHARE, { code: "another88" });
    putStatus = 500;
    await svc.changeCode(SHARE, { code: "failed99" }).catch(() => {});
    const printed = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    const log = JSON.stringify(listLog(SHARE));
    for (const c of ["SECRET77", "ANOTHER88", "FAILED99"]) {
      expect(printed).not.toContain(c);
      expect(log).not.toContain(c);
    }
    expect(
      listLog(SHARE).filter((l) => l.kind === "code_changed")
    ).toHaveLength(1);
    spies.forEach((s) => s.mockRestore());
  });
});
