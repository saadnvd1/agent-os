import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { db, updateSessionRow } from "@/lib/db";
import {
  seedOrchestrator,
  seedSession,
  seedWorkspace,
} from "@/lib/orchestrator/testing";
import { amendBrief } from "@/lib/orchestrator/amendments";
import { claimPiece, releaseClaim, findPiece, workspacePieces } from "./claim";
import { piecesOf } from "./features";
import { releasePieces, type ReleaseDeps } from "./release";
import { startOrQueue } from "@/lib/tasks/queue";

function feature(name = "House") {
  const { app, api } = seedWorkspace();
  seedOrchestrator("orch-claim");
  const planner = seedSession({
    projectId: app.id,
    name: "planner",
    task: true,
  });
  const id = randomUUID();
  const workspace = db
    .prepare(`SELECT workspace_id FROM projects WHERE id = ?`)
    .get(app.id) as { workspace_id: string };
  db.prepare(
    `INSERT INTO features (id, workspace_id, name, plan_session_id, plan_text, status)
     VALUES (?, ?, ?, ?, 'plan', 'building')`
  ).run(id, workspace.workspace_id, name, planner);
  const piece = (
    position: number,
    name: string,
    status: string,
    sessionId: string | null,
    after: number | null
  ) =>
    Number(
      db
        .prepare(
          `INSERT INTO feature_pieces (feature_id, position, name, slice, project_id,
             after_position, after_kind, status, session_id)
           VALUES (?, ?, ?, 'slice', ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          position,
          name,
          app.id,
          after,
          after ? "merged" : null,
          status,
          sessionId
        ).lastInsertRowid
    );
  const first = seedSession({ projectId: app.id, name: "piece 1", task: true });
  const p1 = piece(1, "core", "building", first, null);
  const p2 = piece(2, "runbooks-ui", "waiting", null, 1);
  return {
    app,
    api,
    id,
    planner,
    first,
    p1,
    p2,
    workspaceId: workspace.workspace_id,
  };
}

const deps = () => {
  const start = vi.fn(async () => "started");
  return {
    start,
    deps: {
      deployed: async () => "ok",
      start,
      pushFeatureMerged: () => undefined,
    } as unknown as ReleaseDeps,
  };
};

const sqlNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

const merge = (id: string) =>
  updateSessionRow(db, id, {
    task_status: "merged",
    pr_number: 7,
    merged_at: sqlNow(),
  });

describe("a claimed piece", () => {
  it("doesn't start again when the piece before it merges", async () => {
    const f = feature();
    const claimant = seedSession({
      projectId: f.app.id,
      name: "built by hand",
      task: true,
    });
    claimPiece(f.p2, claimant);
    merge(f.first);
    const { start, deps: d } = deps();
    await releasePieces(d);
    expect(start).not.toHaveBeenCalled();
    expect(piecesOf(f.id).find((p) => p.id === f.p2)).toMatchObject({
      status: "building",
      session_id: claimant,
    });
    merge(claimant);
    await releasePieces(d);
    expect(piecesOf(f.id).find((p) => p.id === f.p2)?.status).toBe("merged");
    expect(start).not.toHaveBeenCalled();
  });

  it("without a claim the sweep does start it (what the claim prevents)", async () => {
    const f = feature();
    merge(f.first);
    const { start, deps: d } = deps();
    await releasePieces(d);
    expect(start).toHaveBeenCalledOnce();
  });

  it("can't be claimed twice", () => {
    const f = feature();
    claimPiece(f.p2, "a");
    expect(() => claimPiece(f.p2, "b")).toThrow(/building, not waiting/);
  });

  it("a queued task claims it under its queue id, and loses the claim cleanly", async () => {
    const f = feature();
    const running = seedSession({
      projectId: f.app.id,
      name: "running one",
      task: true,
    });
    const out = await startOrQueue(
      {
        projectId: f.app.id,
        prompt: "build the ui",
        startedVia: "session",
        startedBy: running,
        parentSessionId: running,
        after: running,
        pieceId: f.p2,
      },
      async () => "unused"
    );
    if (!("queued" in out)) throw new Error("expected it to queue");
    expect(piecesOf(f.id).find((p) => p.id === f.p2)).toMatchObject({
      status: "building",
      session_id: out.queued.id,
    });
    const row = db
      .prepare(
        `SELECT started_by, parent_session_id, started_via FROM task_queue WHERE id = ?`
      )
      .get(out.queued.id);
    expect(row).toEqual({
      started_by: running,
      parent_session_id: running,
      started_via: "session",
    });
    await expect(
      startOrQueue(
        {
          projectId: f.app.id,
          prompt: "again",
          startedVia: "session",
          after: running,
          pieceId: f.p2,
        },
        async () => "unused"
      )
    ).rejects.toThrow(/not waiting/);
    expect(
      db
        .prepare(`SELECT COUNT(*) AS n FROM task_queue WHERE prompt = 'again'`)
        .get()
    ).toEqual({ n: 0 });
  });
});

describe("a plan approved as written", () => {
  it("still credits the planning task's own merge to its waiting pieces; a scope change doesn't", async () => {
    const approved = feature();
    amendBrief(approved.workspaceId, approved.planner, "approved", "approval");
    merge(approved.planner);
    const changed = feature();
    amendBrief(changed.workspaceId, changed.planner, "also the CLI");
    merge(changed.planner);
    await releasePieces(deps().deps);
    const status = (f: ReturnType<typeof feature>) =>
      piecesOf(f.id).find((p) => p.id === f.p2)?.status;
    expect(status(approved)).toBe("merged");
    expect(status(changed)).not.toBe("merged");
  });
});

describe("a claim whose session never came to be", () => {
  it("is given back, and only by the session it was made for", () => {
    const f = feature();
    claimPiece(f.p2, "gone");
    releaseClaim(f.p2, "someone-else");
    expect(piecesOf(f.id).find((p) => p.id === f.p2)?.status).toBe("building");
    releaseClaim(f.p2, "gone");
    expect(piecesOf(f.id).find((p) => p.id === f.p2)).toMatchObject({
      status: "waiting",
      session_id: null,
    });
  });
});

describe("finding a piece", () => {
  it("by feature/name across plans, and lists the waiting ones when it can't", () => {
    const a = feature("Alpha");
    const waiting = workspacePieces(a.workspaceId, a.app.id);
    expect(findPiece(waiting, "2").name).toBe("runbooks-ui");
    expect(findPiece(waiting, "alpha/runbooks-ui").id).toBe(a.p2);
    expect(() => findPiece(waiting, "nope")).toThrow(
      /Waiting pieces: 2 runbooks-ui/
    );
    expect(() => findPiece([], "x")).toThrow(/nothing in your plan is waiting/);
  });
});
