/**
 * The client against the real route handlers, in one process standing in for
 * two machines: the Mac's database is the default one, the box's is scoped
 * around each handler (lib/db/machine-scope.ts). The only fakes are the edges
 * a handler would reach out to (the agent, git, tmux); authorization and
 * routing are the real ones.
 */
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
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

const calls = vi.hoisted(() => ({
  signOff: [] as { id: string; head?: string; base?: string }[],
  drop: [] as string[],
  done: [] as string[],
  stop: [] as string[],
  approve: [] as string[],
  chat: [] as { id?: string; text: string }[],
  exported: [] as string[],
  resumed: [] as string[],
  moved: [] as string[],
  imported: 0,
  model: [] as string[],
  priority: [] as string[],
}));

vi.mock("@/lib/tasks", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks")>()),
  signOffTask: async (id: string, o: { head?: string; base?: string }) => {
    calls.signOff.push({ id, head: o.head, base: o.base });
    return "squash";
  },
  dropTask: async (id: string) => {
    calls.drop.push(id);
  },
  moveTask: async (id: string) => {
    calls.moved.push(id);
    return { id };
  },
}));
vi.mock("@/lib/tasks/queue", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks/queue")>()),
  setPriority: (id: string) => {
    calls.priority.push(id);
  },
}));
vi.mock("@/lib/models/resume", () => ({
  resumeOnModel: async (id: string) => {
    calls.model.push(id);
    return { ok: true };
  },
}));
vi.mock("@/lib/models/plan-step", async (orig) => ({
  ...(await orig<typeof import("@/lib/models/plan-step")>()),
  approvePlanNow: async (id: string) => {
    calls.approve.push(id);
    return { ref: "sonnet" };
  },
}));
vi.mock("@/lib/sessions/stop", () => ({
  stopSession: async (t: { id: string }) => {
    calls.stop.push(t.id);
    return "Stopped it.";
  },
}));
vi.mock("@/lib/done", async (orig) => ({
  ...(await orig<typeof import("@/lib/done")>()),
  doneSession: async (id: string) => {
    calls.done.push(id);
    return { merged: false };
  },
}));
vi.mock("@/lib/chat/runner", async (orig) => ({
  ...(await orig<typeof import("@/lib/chat/runner")>()),
  sendChatConfirmed: async (_id: string, m: { id?: string; text: string }) => {
    calls.chat.push({ id: m.id, text: m.text });
    return "sent";
  },
  chatStateNow: async () => "idle",
}));
vi.mock("@/lib/tasks/move", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks/move")>()),
  exportOrResume: async (id: string) => {
    calls.exported.push(id);
    return { id, stub: true };
  },
}));
vi.mock("@/lib/tasks/move-recover", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks/move-recover")>()),
  resumeHere: async (id: string) => {
    calls.resumed.push(id);
  },
}));
vi.mock("@/lib/tasks/import", async (orig) => ({
  ...(await orig<typeof import("@/lib/tasks/import")>()),
  importTask: async () => {
    calls.imported++;
    return { id: "arrived-1", name: "arrived" };
  },
}));
vi.mock("@/lib/tasks/moved-away", () => ({ cleanUpMovedAway: async () => {} }));

const { db, insertSessionRow, updateSessionRow } = await import("@/lib/db");
const { createSchema } = await import("@/lib/db/schema");
const { runMigrations } = await import("@/lib/db/migrations");
const { runOnMachine } = await import("@/lib/db/machine-scope");
const { DEVICE_HEADER } = await import("@/lib/security/auth");
const { createHost } = await import("@/lib/hosts");
const { saveHostLink, requireHostLink, HostApiError } =
  await import("@/lib/hosts/remote-api");
const { PLAN_FILE } = await import("@/lib/models/plan-step");
const client = await import("./client");
const { syncMirrors } = await import("./sync");
const { mirrorTask } = await import("./start");

const routes = import.meta.glob("../../../app/api/tasks/**/route.ts");
const DEVICES: Record<string, string> = {
  "tok-mac": "dev-mac",
  "tok-other": "dev-other",
};

const boxDb = new Database(":memory:");
createSchema(boxDb);
runMigrations(boxDb);

async function handler(url: URL, method: string) {
  const parts = url.pathname.split("/").filter(Boolean).slice(2);
  const fixed = ["import", "arrived", "held-replies"];
  const [first, leaf] = parts;
  const file =
    parts.length === 0
      ? "route.ts"
      : parts.length === 1 && fixed.includes(first)
        ? `${first}/route.ts`
        : `[id]/${leaf}/route.ts`;
  const load = routes[`../../../app/api/tasks/${file}`];
  if (!load) throw new Error(`no route ${url.pathname}`);
  const mod = (await load()) as Record<
    string,
    (
      r: NextRequest,
      c: { params: Promise<{ id: string }> }
    ) => Promise<Response>
  >;
  return {
    run: mod[method],
    params: { id: parts.length > 1 || !fixed.includes(first) ? first : "" },
  };
}

// The box's AgentOS: the real handlers over the box's database, for the
// device the bearer token belongs to.
async function boxFetch(input: string | URL | Request, init?: RequestInit) {
  const url = new URL(String(input));
  const token = String(
    (init?.headers as Record<string, string>)?.Authorization ?? ""
  ).replace("Bearer ", "");
  const device = DEVICES[token];
  const method = init?.method ?? "GET";
  const body = init?.body as string | undefined;
  const headers: Record<string, string> = {
    "content-length": String(body?.length ?? 0),
    ...(device && { [DEVICE_HEADER]: device }),
  };
  const request = new NextRequest(url, { method, headers, body });
  const { run, params } = await handler(url, method);
  return runOnMachine(boxDb, () =>
    run(request, { params: Promise.resolve({ id: params.id }) })
  );
}

let hostId: string;
let link: ReturnType<typeof requireHostLink>;
let other: typeof link;
let planDir: string;

function onBox<T>(fn: () => T): T {
  return runOnMachine(boxDb, fn);
}
const boxRow = (id: string) =>
  onBox(
    () =>
      boxDb
        .prepare(`SELECT * FROM session_rows WHERE id = ?`)
        .get(id) as Record<string, unknown>
  );

function boxTask(
  extra: { held?: boolean; started?: boolean; plan?: boolean } = {}
) {
  const id = randomUUID();
  insertSessionRow(boxDb, {
    id,
    name: "on the box",
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    worktree_path: planDir,
    view: "chat",
    task_status: "running",
    task_prompt: "do x",
    held_by_device: extra.held === false ? null : "dev-mac",
    held_from: extra.held === false ? null : "the Mac",
    started_by_device: extra.started === false ? null : "dev-mac",
    plan_phase: extra.plan ? "awaiting" : null,
    plan_waits_for_caller: extra.plan ? 1 : null,
  });
  return id;
}

beforeAll(async () => {
  hostId = createHost("devbox", "alice@devbox").id;
  saveHostLink(hostId, "http://box.test", "tok-mac");
  link = requireHostLink(hostId);
  other = { ...link, token: "tok-other" };
  planDir = await fs.mkdtemp(path.join(os.tmpdir(), "contract-plan-"));
  await fs.mkdir(path.dirname(path.join(planDir, PLAN_FILE)), {
    recursive: true,
  });
  await fs.writeFile(path.join(planDir, PLAN_FILE), "# the plan\n");
  vi.stubGlobal("fetch", vi.fn(boxFetch));
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await fs.rm(planDir, { recursive: true, force: true });
});
beforeEach(() => {
  client.forget(hostId);
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) {
    const v = calls[k];
    if (Array.isArray(v)) v.length = 0;
    else (calls[k] as number) = 0;
  }
});

describe("every operation, as the machine that holds the task", () => {
  it("lists it, with the capabilities that mark the contract", async () => {
    const id = boxTask();
    const { tasks, capabilities } = await client.list(link, true);
    expect(tasks.map((t) => t.id)).toContain(id);
    expect(capabilities).toContain("task-contract-1");
    expect((await client.view(link, id))?.id).toBe(id);
  });

  it("relays a message keyed by its id, reads the chat, stops and finishes it", async () => {
    const id = boxTask();
    expect(
      await client.message(link, id, { id: "bus-7", line: "hi", from: "orch" })
    ).toBe("delivered");
    expect(calls.chat).toEqual([{ id: "bus-7", text: "hi" }]);
    expect(await client.chatTail(link, id, 20)).toBe("");
    expect(await client.chatFacts(link, id)).toEqual({
      blocked: null,
      turn: "idle",
    });
    expect(await client.stop(link, id)).toBe("Stopped it.");
    await client.done(link, id);
    expect(calls.stop).toEqual([id]);
    expect(calls.done).toEqual([id]);
  });

  it("merges pinned to a head, and says which method", async () => {
    const id = boxTask();
    const head = "a".repeat(40);
    expect(await client.merge(link, id, { head, base: "main" })).toEqual({
      head,
      method: "squash",
    });
    expect(calls.signOff).toEqual([{ id, head, base: "main" }]);
  });

  it("drops it", async () => {
    const id = boxTask();
    await client.drop(link, id);
    expect(calls.drop).toEqual([id]);
  });

  it("reads a written plan and approves it", async () => {
    const id = boxTask({ plan: true });
    expect(await client.plan(link, id)).toBe("# the plan\n");
    expect(await client.approvePlan(link, id, "go")).toMatchObject({
      model: "sonnet",
    });
    expect(calls.approve).toEqual([id]);
  });

  it("holds a task its starter placed before machines held them", async () => {
    const id = boxTask({ held: false });
    await client.hold(link, id, {
      heldFrom: "the Mac",
      since: null,
      modelProvider: null,
      modelOverrides: null,
      planPhase: null,
      planFile: null,
    });
    expect(boxRow(id).held_by_device).toBe("dev-mac");
    await expect(
      client.hold(other, id, {
        heldFrom: "x",
        since: null,
        modelProvider: null,
        modelOverrides: null,
        planPhase: null,
        planFile: null,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("moves out and back: import, arrived, export, resume, moved", async () => {
    const id = boxTask();
    const imported = await client.importBundle(link, {
      version: 1,
      id: "x",
    } as never);
    expect(imported.session).toMatchObject({ id: "arrived-1" });
    expect(
      await client.arrived(link, "00000000-0000-4000-8000-000000000000")
    ).toBeNull();
    expect(await client.exportOut(link, id, "the Mac")).toMatchObject({ id });
    await client.resume(link, id, { force: true });
    await client.confirmMoved(link, id, "the Mac");
    expect(calls.exported).toEqual([id]);
    expect(calls.resumed).toEqual([id]);
    expect(boxRow(id).task_status).toBe("moved");
  });

  it("answers an unheld task on a holder route with 404", async () => {
    const id = boxTask({ held: false });
    await expect(client.chatTail(link, id, 5)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("a device that isn't the holder", () => {
  const ops: [string, (id: string) => Promise<unknown>][] = [
    ["message", (id) => client.message(other, id, { line: "x", from: "o" })],
    ["chat-tail", (id) => client.chatTail(other, id, 5)],
    ["chat-facts", (id) => client.chatFacts(other, id)],
    ["stop", (id) => client.stop(other, id)],
    ["done", (id) => client.done(other, id)],
    ["merge", (id) => client.merge(other, id)],
    ["drop", (id) => client.drop(other, id)],
    ["plan", (id) => client.plan(other, id)],
    ["approve-plan", (id) => client.approvePlan(other, id)],
    ["export", (id) => client.exportOut(other, id, "x")],
    ["resume", (id) => client.resume(other, id)],
    ["moved", (id) => client.confirmMoved(other, id, "x")],
  ];

  it.each(ops)(
    "is refused on %s with 403, and nothing happens",
    async (_n, op) => {
      const id = boxTask({ plan: true });
      const err = (await op(id).catch((e) => e)) as Error;
      expect(err).toBeInstanceOf(HostApiError);
      expect(err).toMatchObject({ status: 403, refused: true });
      expect(err.message).toMatch(/orchestrator on the Mac decides/);
      expect(boxRow(id).task_status).toBe("running");
      for (const list of Object.values(calls))
        if (Array.isArray(list)) expect(list).toEqual([]);
    }
  );

  it("can't hold a task another device started", async () => {
    const id = boxTask({ held: false });
    await expect(
      client.hold(other, id, {
        heldFrom: "x",
        since: null,
        modelProvider: null,
        modelOverrides: null,
        planPhase: null,
        planFile: null,
      })
    ).rejects.toMatchObject({ refused: true });
    expect(boxRow(id).held_by_device).toBeNull();
  });
});

describe("this machine's own web UI, which sends no device", () => {
  const post = (url: string, body: object = {}, method = "POST") =>
    new NextRequest(`http://localhost${url}`, {
      method,
      body: JSON.stringify(body),
    });
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

  function localRow(mirror: boolean) {
    const id = randomUUID();
    insertSessionRow(db, {
      id,
      name: "t",
      tmux_name: `claude-${id}`,
      working_directory: "/tmp",
      view: "chat",
      task_status: "running",
      task_prompt: "x",
      host_id: mirror ? hostId : "local",
      plan_phase: "awaiting",
      plan_waits_for_caller: mirror ? 1 : null,
    });
    return id;
  }

  it.each([
    ["a mirror of the box's task", true],
    ["a task running here", false],
  ])(
    "can drop, move, approve, re-prioritise and re-model %s",
    async (_n, mirror) => {
      const id = localRow(mirror);
      const [drop, move, approve, priority, model] = await Promise.all([
        import("@/app/api/tasks/[id]/drop/route"),
        import("@/app/api/tasks/[id]/move/route"),
        import("@/app/api/tasks/[id]/approve-plan/route"),
        import("@/app/api/tasks/[id]/priority/route"),
        import("@/app/api/tasks/[id]/model/route"),
      ]);
      const statuses = [
        (await drop.POST(post(`/api/tasks/${id}/drop`), ctx(id))).status,
        (
          await move.POST(
            post(`/api/tasks/${id}/move`, { hostId: "x" }),
            ctx(id)
          )
        ).status,
        (await approve.POST(post(`/api/tasks/${id}/approve-plan`), ctx(id)))
          .status,
        (
          await priority.PATCH(
            post(`/api/tasks/${id}/priority`, { priority: "urgent" }, "PATCH"),
            ctx(id)
          )
        ).status,
        (
          await model.POST(
            post(`/api/tasks/${id}/model`, { model: "x" }),
            ctx(id)
          )
        ).status,
      ];
      expect(statuses).toEqual([200, 200, 200, 200, 200]);
      expect(calls.drop).toEqual([id]);
      expect(calls.approve).toEqual([id]);
      expect(calls.moved).toEqual([id]);
      expect(calls.priority).toEqual([id]);
      expect(calls.model).toEqual([id]);
    }
  );
});

describe("the sync loop", () => {
  it("records what the machine says: moved, and a plan written there", async () => {
    const gone = boxTask();
    mirrorTask(hostId, null, {
      id: gone,
      name: "gone",
      tmux_name: "t",
      working_directory: "/tmp",
      task_prompt: "x",
    } as never);
    onBox(() =>
      updateSessionRow(boxDb, gone, {
        task_status: "moved",
        moved_to: "the Mac",
        host_id: "local",
      })
    );
    client.forget(hostId);
    await syncMirrors();
    expect(
      (
        db
          .prepare(`SELECT task_status FROM session_rows WHERE id = ?`)
          .get(gone) as {
          task_status: string;
        }
      ).task_status
    ).toBe("moved");
  });
});
