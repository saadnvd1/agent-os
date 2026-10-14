import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// What `aos task` / `aos spawn` start records about who asked, and the plan
// piece a task claims.

interface Opts {
  projectId?: string;
  startedBy?: string | null;
  parentSessionId?: string | null;
  startedVia?: string;
  pieceId?: number;
}
const tasks: Opts[] = [];
const sessions: Opts[] = [];
vi.mock("@/lib/tasks", () => ({
  createTask: async (o: Opts) => {
    tasks.push(o);
    return { id: "t1", name: "t" };
  },
}));
vi.mock("@/lib/tasks/queue", () => ({
  stampPriority: () => undefined,
  startOrQueue: async (_: unknown, start: () => Promise<unknown>) => ({
    started: await start(),
  }),
}));
vi.mock("@/lib/agents/spawn", async () => {
  const { getProject } = await import("@/lib/projects");
  return {
    findProject: (id: string) => getProject(id),
    spawnSession: async (o: Opts) => {
      sessions.push(o);
      return { id: "s1", name: "s" };
    },
  };
});

const { db } = await import("@/lib/db");
const { createProject } = await import("@/lib/projects");
const { seedOrchestrator, seedSession } =
  await import("@/lib/orchestrator/testing");
const { POST } = await import("@/app/api/bus/spawn/route");

const web = createProject({
  name: `web-${randomUUID().slice(0, 6)}`,
  workingDirectory: "/tmp/web",
});
const other = createProject({
  name: `other-${randomUUID().slice(0, 6)}`,
  workingDirectory: "/tmp/other",
});

const third = createProject({
  name: `third-${randomUUID().slice(0, 6)}`,
  workingDirectory: "/tmp/third",
});

const post = (body: object) =>
  POST(
    new NextRequest("http://127.0.0.1:3011/api/bus/spawn", {
      method: "POST",
      body: JSON.stringify({ project: web.id, prompt: "p", ...body }),
    })
  );

beforeEach(() => {
  tasks.length = 0;
  sessions.length = 0;
});

function seedTask(worktree?: string) {
  const id = seedSession({ projectId: web.id, name: "caller", task: true });
  if (worktree)
    db.prepare(`UPDATE sessions SET worktree_path = ? WHERE id = ?`).run(
      worktree,
      id
    );
  return id;
}

describe("who an aos start records", () => {
  it("a person: no starter", async () => {
    await post({ mode: "task" });
    expect(tasks[0]).toMatchObject({
      startedBy: null,
      parentSessionId: null,
      startedVia: "person",
    });
  });

  it("a task starting a task is the starter and the parent", async () => {
    const caller = seedTask();
    await post({ mode: "task", from: caller });
    expect(tasks[0]).toMatchObject({
      startedBy: caller,
      parentSessionId: caller,
      startedVia: "session",
    });
  });

  it("an orchestrator", async () => {
    seedOrchestrator("orch-x");
    await post({ mode: "task", from: "orch-x" });
    expect(tasks[0]).toMatchObject({
      startedBy: "orch-x",
      parentSessionId: "orch-x",
      startedVia: "orchestrator",
    });
  });

  it("without from, the worktree it is run in names the task", async () => {
    const wt = `/tmp/wt-${randomUUID().slice(0, 8)}`;
    const caller = seedTask(wt);
    await post({ mode: "task", cwd: `${wt}/app/lib` });
    expect(tasks[0]).toMatchObject({
      startedBy: caller,
      startedVia: "session",
    });
  });

  it("a made-up from, or a folder that is no worktree, is a person", async () => {
    await post({ mode: "task", from: "nobody", cwd: "/tmp/elsewhere" });
    await post({ mode: "task", cwd: "relative/path" });
    expect(tasks.map((t) => t.startedVia)).toEqual(["person", "person"]);
  });

  it("aos spawn from a task records it too", async () => {
    const caller = seedTask();
    await post({ mode: "session", from: caller });
    expect(sessions[0]).toMatchObject({
      startedBy: caller,
      parentSessionId: caller,
    });
  });
});

describe("a task claims the plan piece it builds", () => {
  function plan(caller: string) {
    const feature = randomUUID();
    db.prepare(
      `INSERT INTO features (id, workspace_id, name, plan_session_id, plan_text, status)
       VALUES (?, 'ws', 'House', ?, 'plan', 'building')`
    ).run(feature, caller);
    const piece = (position: number, name: string, project: string) =>
      Number(
        db
          .prepare(
            `INSERT INTO feature_pieces (feature_id, position, name, slice, project_id, status)
             VALUES (?, ?, ?, 's', ?, 'waiting')`
          )
          .run(feature, position, name, project).lastInsertRowid
      );
    return {
      ui: piece(2, "runbooks-ui", web.id),
      docs: piece(3, "docs", web.id),
      elsewhere: piece(4, "infra", other.id),
    };
  }

  it("refuses a task in the same project that names none, and lists the waiting pieces", async () => {
    const caller = seedTask();
    plan(caller);
    const res = await post({ mode: "task", from: caller });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain("2 runbooks-ui, 3 docs");
    expect(error).toContain("--piece");
    expect(tasks).toEqual([]);
  });

  it("claims the named piece, by name or number", async () => {
    const caller = seedTask();
    const ids = plan(caller);
    const res = await post({
      mode: "task",
      from: caller,
      piece: "Runbooks-UI",
    });
    expect(res.status).toBe(201);
    expect(tasks[0].pieceId).toBe(ids.ui);
    await post({ mode: "task", from: caller, piece: "3" });
    expect(tasks[1].pieceId).toBe(ids.docs);
  });

  it("a piece that isn't waiting is refused with the ones that are", async () => {
    const caller = seedTask();
    plan(caller);
    const res = await post({ mode: "task", from: caller, piece: "nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Waiting pieces: 2 runbooks-ui");
  });

  it("another project, or a caller with no plan, is not held up", async () => {
    const caller = seedTask();
    plan(caller);
    expect(
      (await post({ mode: "task", from: caller, project: third.id })).status
    ).toBe(201);
    expect((await post({ mode: "task", from: seedTask() })).status).toBe(201);
    expect((await post({ mode: "task" })).status).toBe(201);
  });

  it("a piece goes with tasks only", async () => {
    const res = await post({ mode: "session", piece: "x" });
    expect(res.status).toBe(400);
  });
});
