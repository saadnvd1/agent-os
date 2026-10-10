import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// In a demo these routes write the database and do nothing else: any
// process they start is recorded here, and must not happen.
const spawned = vi.hoisted(() => [] as string[]);
vi.mock("child_process", async (original) => {
  const real = await original<typeof import("child_process")>();
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      spawned.push(`${name} ${String(args[0])}`);
      throw new Error(`${name} in a demo write`);
    };
  const fake = {
    exec: record("exec"),
    execFile: record("execFile"),
    execSync: record("execSync"),
    execFileSync: record("execFileSync"),
    spawn: record("spawn"),
  };
  return { ...real, ...fake, default: { ...real, ...fake } };
});

const { db } = await import("@/lib/db");
const { DEVICE_HEADER, TRUST_HEADER } = await import("@/lib/security/auth");
const { mintDevice, getDevice } = await import("@/lib/security/devices");
const { DEMO_VISITOR_TEXT } = await import("@/lib/security/demo");
const { raiseAsk, askBinding, getAsk } =
  await import("@/lib/orchestrator/asks");
const devicesRoute = await import("@/app/api/devices/route");
const networkRoute = await import("@/app/api/devices/network/route");
const deviceRoute = await import("@/app/api/devices/[id]/route");
const pinRoute = await import("@/app/api/sessions/[id]/pin/route");
const doneRoute = await import("@/app/api/sessions/[id]/done/route");
const askRoute =
  await import("@/app/api/workspaces/[id]/orchestrator/asks/[askId]/route");

beforeAll(() => vi.stubEnv("AGENTOS_DEMO", "1"));
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => (spawned.length = 0));

const req = (
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {}
) =>
  new NextRequest("http://x", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = <T extends object>(params: T) => ({
  params: Promise.resolve(params),
});

function newSession(task = false): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, task_prompt, task_status)
     VALUES (?, 'demo', ?, '~/code/a', ?, ?)`
  ).run(id, `claude-${id}`, task ? "do it" : null, task ? "running" : null);
  return id;
}

describe("demo: GET /api/devices", () => {
  it("says how the request was trusted, and lists devices without addresses or browsers", async () => {
    const { device } = mintDevice("phone", "Some Browser/1.0");
    db.prepare(
      `UPDATE devices SET last_address = '203.0.113.9' WHERE id = ?`
    ).run(device.id);
    const res = await devicesRoute.GET(
      req("GET", undefined, { [TRUST_HEADER]: "open" })
    );
    const body = await res.json();
    expect(body.current).toEqual({ deviceId: null, via: "open" });
    const listed = body.devices.find((d: { id: string }) => d.id === device.id);
    expect(listed).toMatchObject({ name: "phone" });
    expect(JSON.stringify(body)).not.toContain("203.0.113.9");
    expect(JSON.stringify(body)).not.toContain("Some Browser");
    expect(listed).not.toHaveProperty("token_hash");
  });
});

describe("demo: GET /api/devices/network", () => {
  it("is a stub with no addresses, tailnet or Connect", async () => {
    const body = await (await networkRoute.GET()).json();
    expect(body).toEqual({
      lan: { on: false, locked: true },
      requirePairingOnTailnet: { on: false, locked: true },
      tailscale: { state: "missing" },
      reach: [],
      connect: { state: "off" },
      mergeApprovals: { on: false, locked: true },
    });
    expect(spawned).toEqual([]);
  });
});

describe("demo: DELETE /api/devices/:id", () => {
  it("signs the caller's own device out", async () => {
    const { device } = mintDevice("mine");
    const res = await deviceRoute.DELETE(
      req("DELETE", undefined, { [DEVICE_HEADER]: device.id }),
      ctx({ id: device.id })
    );
    expect(res.status).toBe(200);
    expect(getDevice(device.id)?.revoked_at).toBeTruthy();
  });

  it("refuses anyone else's, and an open (unpaired) caller's", async () => {
    const { device } = mintDevice("theirs");
    const other = mintDevice("mine").device;
    const callers: Record<string, string>[] = [
      { [DEVICE_HEADER]: other.id },
      {},
    ];
    for (const headers of callers) {
      const res = await deviceRoute.DELETE(
        req("DELETE", undefined, headers),
        ctx({ id: device.id })
      );
      expect(res.status).toBe(403);
    }
    expect(getDevice(device.id)?.revoked_at).toBeFalsy();
  });
});

describe("demo: POST /api/sessions/:id/pin", () => {
  it("pins and unpins in the database", async () => {
    const id = newSession();
    const pinned = () =>
      (
        db.prepare(`SELECT pinned FROM sessions WHERE id = ?`).get(id) as {
          pinned: number;
        }
      ).pinned;
    expect(
      (await pinRoute.POST(req("POST", { pinned: true }), ctx({ id }))).status
    ).toBe(200);
    expect(pinned()).toBe(1);
    await pinRoute.POST(req("POST", { pinned: false }), ctx({ id }));
    expect(pinned()).toBe(0);
    expect(spawned).toEqual([]);
  });
});

describe("demo: POST /api/sessions/:id/done", () => {
  it("refuses an orchestrator, and a session already archived", async () => {
    const orch = newSession();
    db.prepare(`UPDATE sessions SET role = 'orchestrator' WHERE id = ?`).run(
      orch
    );
    const archived = newSession();
    db.prepare(
      `UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`
    ).run(archived);
    for (const id of [orch, archived])
      expect((await doneRoute.POST(req("POST"), ctx({ id }))).status).toBe(409);
    const row = db
      .prepare(`SELECT archived_at FROM sessions WHERE id = ?`)
      .get(orch) as {
      archived_at: string | null;
    };
    expect(row.archived_at).toBeNull();
  });

  it("archives, marks a task done, and runs nothing", async () => {
    const id = newSession(true);
    const res = await doneRoute.POST(req("POST"), ctx({ id }));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toMatchObject({
      id,
      merged: null,
      worktree: { action: "none" },
    });
    const row = db
      .prepare(`SELECT archived_at, task_status FROM sessions WHERE id = ?`)
      .get(id) as { archived_at: string | null; task_status: string };
    expect(row.archived_at).toBeTruthy();
    expect(row.task_status).toBe("done");
    expect(spawned).toEqual([]);
  });
});

describe("demo: POST /api/workspaces/:id/orchestrator/asks/:askId", () => {
  const workspace = randomUUID();
  beforeAll(() => {
    db.prepare(
      `INSERT INTO workspaces (id, name, sort_order) VALUES (?, 'W', 0)`
    ).run(workspace);
  });
  const ask = (kind: "decision" | "gate" | "passkey") =>
    raiseAsk({
      workspaceId: workspace,
      subject: `s-${randomUUID()}`,
      kind,
      title: "Ship it?",
    }).ask;
  const answer = (id: number, body: unknown) =>
    askRoute.POST(req("POST", body), ctx({ id: workspace, askId: String(id) }));

  it("takes a reply from any visitor", async () => {
    const a = ask("decision");
    const visitor = "visit https://example.test now";
    const res = await answer(a.id, { action: "reply", text: visitor });
    expect(res.status).toBe(200);
    const answered = getAsk(workspace, a.id);
    expect(answered?.status).toBe("resolved");
    // Kept and shown as canned text, never the visitor's words.
    expect(answered?.answer).toBe(DEMO_VISITOR_TEXT);
    const notes = db
      .prepare(`SELECT text FROM orchestrator_notes WHERE workspace_id = ?`)
      .all(workspace) as { text: string }[];
    expect(notes.some((n) => n.text.includes(DEMO_VISITOR_TEXT))).toBe(true);
    expect(JSON.stringify(notes)).not.toContain("example.test");
  });

  it("approves a gate without a passkey: nothing acts on it in a demo", async () => {
    const a = ask("gate");
    const res = await answer(a.id, {
      action: "approve",
      binding: askBinding(a),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ask).toMatchObject({
      id: a.id,
      status: "approved",
    });
    expect(getAsk(workspace, a.id)?.status).toBe("approved");
  });

  it("still refuses an approval of an ask that changed since it was seen", async () => {
    const a = ask("gate");
    const res = await answer(a.id, {
      action: "approve",
      binding: askBinding(a) + "x",
    });
    expect(res.status).toBe(409);
    expect(getAsk(workspace, a.id)?.status).toBe("open");
  });

  it("refuses passkey asks, which would change the demo's passkeys", async () => {
    const a = ask("passkey");
    expect(
      (await answer(a.id, { action: "decline", binding: askBinding(a) })).status
    ).toBe(403);
    expect(getAsk(workspace, a.id)?.status).toBe("open");
  });

  it("outside a demo still needs an approver", async () => {
    vi.stubEnv("AGENTOS_DEMO", "");
    try {
      const a = ask("decision");
      expect((await answer(a.id, { action: "reply", text: "x" })).status).toBe(
        403
      );
    } finally {
      vi.stubEnv("AGENTOS_DEMO", "1");
    }
  });
});
