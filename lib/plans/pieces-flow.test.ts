import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { retireChat } = vi.hoisted(() => ({
  retireChat: vi.fn(async () => {}),
}));
vi.mock("../chat/runner", () => ({ retireChat, sendQueuedNow: vi.fn() }));
const { doneSession } = vi.hoisted(() => ({
  doneSession: vi.fn(async () => ({})),
}));
vi.mock("../done", () => ({ doneSession }));
const { createTask } = vi.hoisted(() => ({
  createTask: vi.fn(async (o: { id?: string }) => ({ id: o.id })),
}));
vi.mock("../tasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tasks")>()),
  createTask,
}));

import { db, type Session } from "../db";
import { createWorkspace, setProjectWorkspace } from "../workspaces";
import { createProject } from "../projects";
import { listQueue } from "../chat/queued";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { amendBrief, amendmentsOf } from "../orchestrator/amendments";
import { pendingEvents } from "../orchestrator/events";
import {
  PLAN_FILE,
  approvePlan,
  handoffAfterPlan,
  implementPrompt,
  preparePlanDir,
} from "../models/plan-step";
import { sessionListColumns } from "../db/queries";
import { rowGroup } from "../recipes/chip";
import { recordTurn } from "../usage/turns";
import {
  checkContext,
  featureOfPlan,
  getFeature,
  pieceOfSession,
  piecesOf,
  planFor,
  prOf,
  reviewGoal,
} from "./features";
import { editWaiting, realDeps, releaseAnyway, releasePieces } from "./release";
import type { ReleaseDeps } from "./release";

process.env.AGENTOS_PLANS_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "plans-")
);

const turn = {
  costUsd: 0.5,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const ONE = "# Plan\nDo it.\n\n## Pieces\n1. Core: everything\n";

function task(
  planOnly: boolean,
  planText: (api: string, app: string) => string
) {
  const { app, api } = seedWorkspace();
  const id = seedSession({
    projectId: app.id,
    name: "Big feature",
    view: "chat",
    task: true,
  });
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "pieces-"));
  db.prepare(
    `UPDATE sessions SET worktree_path = ?, model = 'claude-opus-5-5', plan_phase = 'planning', plan_only = ?, started_by = 'orch-1' WHERE id = ?`
  ).run(worktree, planOnly ? 1 : 0, id);
  recordTurn(
    { id, name: "Big feature", workspace_id: null },
    null,
    turn,
    Date.now(),
    null,
    () => null
  );
  preparePlanDir(worktree);
  fs.writeFileSync(
    path.join(worktree, PLAN_FILE),
    planText(api.name, app.name)
  );
  return { id, app, api };
}

const TWO = (api: string, app: string) =>
  `# Plan\n\n## Pieces\n1. Core: the engine  (repo: ${app})\n   owns: migration 80\n2. Hooks: the client  (repo: ${api})\n   after: 1 is merged\n   why split: (a)\n`;

beforeEach(() => retireChat.mockClear());

describe("handoff", () => {
  it("one piece behaves exactly as before and makes no feature", async () => {
    const { id } = task(false, () => ONE);
    const send = vi.fn(async () => {});
    await handoffAfterPlan(id, send);
    const queued = listQueue(id);
    expect(queued[0].text).toBe(implementPrompt(true));
    expect(featureOfPlan(id)).toBeUndefined();
  });

  it("several pieces: a feature, piece 1 continues here with only its slice", async () => {
    const { id, api } = task(false, TWO);
    const send = vi.fn(async () => {});
    await handoffAfterPlan(id, send);
    const feature = featureOfPlan(id)!;
    expect(feature.status).toBe("building");
    const pieces = piecesOf(feature.id);
    expect(pieces.map((p) => [p.position, p.status])).toEqual([
      [1, "building"],
      [2, "waiting"],
    ]);
    expect(pieces[1]).toMatchObject({
      project_id: api.id,
      after_position: 1,
      after_kind: "merged",
    });
    expect(pieceOfSession(id)?.position).toBe(1);
    const text = listQueue(id)[0].text;
    expect(text).toContain("piece 1 of 2");
    expect(text).toContain("the engine");
    expect(text).not.toContain("the client");
    expect(
      fs.existsSync(
        path.join(process.env.AGENTOS_PLANS_DIR!, `${feature.id}.md`)
      )
    ).toBe(true);
    // The orchestrator hears the split.
    const line = pendingEvents(feature.workspace_id).find(
      (e) => e.subject === id
    )!.line;
    expect(line).toContain("2 pieces");
  });

  it("plan-only: approval applies the edits and lists what isn't built", async () => {
    const { id } = task(true, TWO);
    db.prepare(`UPDATE sessions SET plan_edits = ? WHERE id = ?`).run(
      JSON.stringify({ drop: [2] }),
      id
    );
    await handoffAfterPlan(id, async () => {});
    const sent = vi.fn(async () => {});
    await approvePlan(id, "go", sent);
    expect(featureOfPlan(id)).toBeUndefined();
    expect(listQueue(id)[0].text).toContain("Not building");
    expect(amendmentsOf(id)).toHaveLength(1);
  });
});

function build() {
  const { id } = task(false, TWO);
  return handoffAfterPlan(id, async () => {}).then(() => ({
    id,
    feature: featureOfPlan(id)!,
  }));
}

const deps = (over: Partial<ReleaseDeps> = {}) => {
  const started: { piece: number; prompt: string }[] = [];
  const d: ReleaseDeps = {
    deployed: async () => "ok",
    start: async (_f, piece, prompt, sessionId) => {
      started.push({ piece: piece.position, prompt });
      seedPieceSession(sessionId);
      return sessionId;
    },
    pushFeatureMerged: vi.fn(),
    ...over,
  };
  return { d, started };
};

function seedPieceSession(id: string) {
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, name, tmux_name, working_directory, task_status)
     VALUES (?, 'piece', ?, '/tmp', 'running')`
  ).run(id, `claude-${id}`);
}

const merge = (id: string, pr = 241) =>
  db
    .prepare(
      `UPDATE sessions SET task_status = 'merged', pr_number = ?, merged_at = datetime('now') WHERE id = ?`
    )
    .run(pr, id);

describe("release", () => {
  it("holds a piece until its dependency merges, then starts it once", async () => {
    const { id, feature } = await build();
    const { d, started } = deps();
    await releasePieces(d);
    expect(started).toEqual([]);
    merge(id);
    await releasePieces(d);
    await releasePieces(d);
    expect(started).toHaveLength(1);
    expect(started[0].prompt).toContain("piece 2 of 2");
    expect(started[0].prompt).toContain("1 Core merged as #241");
    expect(piecesOf(feature.id)[1].status).toBe("building");
  });

  it("waits for a deploy, and blocks on a failed one", async () => {
    const { id, feature } = await build();
    db.prepare(
      `UPDATE feature_pieces SET after_kind = 'deployed' WHERE feature_id = ? AND position = 2`
    ).run(feature.id);
    merge(id);
    const pending = deps({ deployed: async () => "pending" });
    await releasePieces(pending.d);
    expect(pending.started).toEqual([]);
    expect(piecesOf(feature.id)[1].status).toBe("waiting");
    await releasePieces(deps({ deployed: async () => "failed" }).d);
    expect(piecesOf(feature.id)[1]).toMatchObject({ status: "blocked" });
    expect(
      pendingEvents(feature.workspace_id).some((e) =>
        e.line.includes("deploy failed")
      )
    ).toBe(true);
    expect(releaseAnyway(piecesOf(feature.id)[1].id)).toBe(true);
    const ok = deps();
    await releasePieces(ok.d);
    expect(ok.started).toHaveLength(1);
  });

  it("a dropped dependency blocks what waits on it", async () => {
    const { id, feature } = await build();
    db.prepare(`UPDATE sessions SET task_status = 'dropped' WHERE id = ?`).run(
      id
    );
    const { d, started } = deps();
    await releasePieces(d);
    expect(started).toEqual([]);
    expect(piecesOf(feature.id).map((p) => p.status)).toEqual([
      "dropped",
      "blocked",
    ]);
  });

  it("closes the feature when every kept piece merged, once", async () => {
    const { id, feature } = await build();
    const { d } = deps();
    merge(id, 1);
    await releasePieces(d);
    const second = piecesOf(feature.id)[1].session_id!;
    merge(second, 2);
    await releasePieces(d);
    await releasePieces(d);
    expect(
      db.prepare(`SELECT status FROM features WHERE id = ?`).get(feature.id)
    ).toEqual({ status: "done" });
    expect(d.pushFeatureMerged).toHaveBeenCalledTimes(1);
  });

  it("a held start (brake) leaves the piece waiting", async () => {
    const { id, feature } = await build();
    merge(id);
    const { BrakeRefused } = await import("../orchestrator/brakes");
    await releasePieces(
      deps({
        start: async () => {
          throw new BrakeRefused("task", "paused");
        },
      }).d
    );
    expect(piecesOf(feature.id)[1]).toMatchObject({
      status: "waiting",
      session_id: null,
    });
  });
});

describe("a start that fails", () => {
  it("is tried once and told once across sweeps, and Release anyway retries by the same id", async () => {
    const { id, feature } = await build();
    merge(id);
    const failing = vi.fn(
      async (_f: unknown, _p: unknown, _t: string, _sessionId: string) => {
        throw new Error("the project folder is gone");
      }
    );
    const { d } = deps({ start: failing });
    for (let i = 0; i < 4; i++) await releasePieces(d);
    const piece = piecesOf(feature.id)[1];
    // Other features earlier tests left building are swept too.
    const mine = () =>
      failing.mock.calls.filter(
        ([, p]) => (p as { id: number }).id === piece.id
      );
    expect(mine()).toHaveLength(1);
    expect(piece.status).toBe("blocked");
    expect(piece.note).toContain("the project folder is gone");
    const told = pendingEvents(feature.workspace_id).filter(
      (e) => e.line.includes("couldn't start") && e.line.includes(feature.name)
    );
    expect(told).toHaveLength(1);

    expect(releaseAnyway(piece.id)).toBe(true);
    const retry = deps();
    await releasePieces(retry.d);
    expect(retry.started).toHaveLength(1);
    expect(piecesOf(feature.id)[1].session_id).toBe(mine()[0][3]);
  });

  it("a building piece whose task is gone, and not queued, is blocked", async () => {
    const { id, feature } = await build();
    merge(id);
    await releasePieces(deps().d);
    const piece = piecesOf(feature.id)[1];
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(piece.session_id);
    await releasePieces(deps().d);
    expect(piecesOf(feature.id)[1]).toMatchObject({
      status: "blocked",
      note: "its task is gone",
    });
  });
});

describe("release with the real start and deploy check", () => {
  const real = (): ReleaseDeps => ({
    ...realDeps,
    deployed: async () => "ok",
    pushFeatureMerged: vi.fn(),
  });
  const queueRow = (id: string) =>
    db.prepare(`SELECT status FROM task_queue WHERE id = ?`).get(id) as
      | { status: string }
      | undefined;

  // Zero running tasks allowed in the workspace of the piece's project.
  const limitTasks = (featureId: string) =>
    db
      .prepare(
        `UPDATE workspaces SET max_running_tasks = 0 WHERE id = (SELECT workspace_id FROM projects WHERE id = ?)`
      )
      .run(piecesOf(featureId)[1].project_id);

  it("follows a piece the workspace's task limit queued, under the queue's id", async () => {
    const { id, feature } = await build();
    merge(id);
    limitTasks(feature.id);
    await releasePieces(real());
    const piece = piecesOf(feature.id)[1];
    // Other features left building by earlier tests release too.
    expect(createTask).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: piece.session_id })
    );
    expect(piece.status).toBe("building");
    expect(queueRow(piece.session_id!)).toEqual({ status: "queued" });
    // Still waiting in the queue: nothing to settle, and no second start.
    await releasePieces(real());
    expect(piecesOf(feature.id)[1].status).toBe("building");

    // The queue starts it under that same id, and it merges.
    seedPieceSession(piece.session_id!);
    merge(piece.session_id!, 2);
    await releasePieces(real());
    expect(piecesOf(feature.id)[1].status).toBe("merged");
    expect(featureOfPlan(id)).toBeTruthy();
  });

  it("a piece the queue drops or can't start stops building", async () => {
    const { id, feature } = await build();
    merge(id);
    limitTasks(feature.id);
    await releasePieces(real());
    const queued = piecesOf(feature.id)[1].session_id!;
    db.prepare(
      `UPDATE task_queue SET status = 'failed', error = 'no worktree' WHERE id = ?`
    ).run(queued);
    await releasePieces(real());
    expect(piecesOf(feature.id)[1]).toMatchObject({
      status: "blocked",
      note: "no worktree",
    });
  });

  it("a deploy dependency fails closed without a project, PR or merge time", async () => {
    const { id, feature } = await build();
    merge(id);
    const dep = piecesOf(feature.id)[0];
    const session = (_x: string) =>
      db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as never;
    expect(await realDeps.deployed(dep, session(""))).not.toBe("ok");
    expect(
      await realDeps.deployed({ ...dep, project_id: "gone" }, session(""))
    ).toBe("failed");
    db.prepare(`UPDATE sessions SET pr_number = NULL WHERE id = ?`).run(id);
    expect(await realDeps.deployed(dep, session(""))).toBe("failed");
    db.prepare(
      `UPDATE sessions SET pr_number = 5, merged_at = NULL WHERE id = ?`
    ).run(id);
    expect(await realDeps.deployed(dep, session(""))).toBe("failed");
  });
});

describe("review slice", () => {
  it("judges piece 1 on its slice; the last piece also on the whole plan", async () => {
    const { id, feature } = await build();
    expect(reviewGoal(id)).toContain("the engine");
    expect(reviewGoal(id)).not.toContain("the client");
    expect(reviewGoal(id)).not.toContain("last piece");
    merge(id);
    await releasePieces(deps().d);
    const second = piecesOf(feature.id)[1].session_id!;
    expect(reviewGoal(second)).toContain("last piece");
    expect(reviewGoal(second)).toContain("## Pieces");
  });
});

describe("editWaiting", () => {
  it("merges a waiting piece into the one building, as an amendment", async () => {
    const { id, feature } = await build();
    expect(editWaiting(feature.id, { merge: [2] })).toEqual([
      "2 merged into 1",
    ]);
    expect(amendmentsOf(id)[0].text).toContain("the client");
    expect(piecesOf(feature.id)[1].status).toBe("dropped");
  });
});

describe("plan_pieces", () => {
  it("lists the pieces and applies a drop to waiting ones only", async () => {
    const { id } = await build();
    const { planPiecesText } = await import("../orchestrator/plan-pieces");
    const session = db
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(id) as never;
    expect(planPiecesText(session)).toContain(
      "2. Hooks [waiting] after 1 is merged"
    );
    expect(planPiecesText(session, undefined, [2])).toContain(
      "Edited: 2 dropped"
    );
    expect(planPiecesText(session, undefined, [2])).toContain(
      "Nothing changed"
    );
  });
});

describe("session list", () => {
  it("carries the piece a task builds, for its row's chip", async () => {
    const { id } = await build();
    const row = db
      .prepare(
        `SELECT ${sessionListColumns(db, "s")} FROM sessions s WHERE s.id = ?`
      )
      .get(id) as { recipe_run: string | null; feature_piece: string | null };
    expect(row.recipe_run).toBeNull();
    expect(rowGroup(row)).toMatchObject({
      kind: "feature",
      text: expect.stringContaining("Piece 1/2"),
    });
  });
});

const wsOf = (projectId: string) =>
  (
    db
      .prepare(`SELECT workspace_id FROM projects WHERE id = ?`)
      .get(projectId) as { workspace_id: string }
  ).workspace_id;
const eventsOf = (projectId: string, subject: string) =>
  pendingEvents(wsOf(projectId))
    .filter((e) => e.subject === subject)
    .map((e) => e.line);

// A plan whose first piece is in the other project.
const ELSEWHERE = (api: string, app: string) =>
  `# Plan\n\n## Pieces\n1. Store: the machine API  (repo: ${api})\n   owns: Connect migration 20261013\n2. Ui: the share dialog  (repo: ${app})\n   after: 1 is merged\n   why split: (a) + (b)\n   owns: migration 85\n`;

describe("routing by repo", () => {
  beforeEach(() => {
    doneSession.mockClear();
    createTask.mockClear();
  });

  it("a piece in another project starts as its own task there; the parent builds nothing", async () => {
    const { id, api } = task(false, ELSEWHERE);
    const send = vi.fn(async () => {});
    await handoffAfterPlan(id, send);
    expect(listQueue(id)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(doneSession).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ noMerge: true })
    );
    const feature = featureOfPlan(id)!;
    const pieces = piecesOf(feature.id);
    expect(pieces[0]).toMatchObject({ project_id: api.id, status: "building" });
    expect(pieces[0].session_id).not.toBe(id);
    expect(pieces[1].status).toBe("waiting");
    expect(pieceOfSession(id)).toBeUndefined();
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: api.id })
    );
    expect(createTask.mock.calls[0][0]).toMatchObject({
      prompt: expect.stringContaining("Work only in this task's repository"),
    });
    expect(eventsOf(api.id, id).join()).toMatch(/builds nothing itself/);
  });

  it("a lone piece named for another project is not built by the parent", async () => {
    const { id, api } = task(
      false,
      (api) => `# Plan\n\n## Pieces\n1. Store: the API  (repo: ${api})\n`
    );
    await handoffAfterPlan(id, async () => {});
    expect(listQueue(id)).toEqual([]);
    const feature = featureOfPlan(id)!;
    expect(piecesOf(feature.id)).toHaveLength(1);
    expect(piecesOf(feature.id)[0].project_id).toBe(api.id);
    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: api.id })
    );
  });

  it("the parent still builds its own piece, and the brief forbids the others", async () => {
    const { id } = task(false, TWO);
    await handoffAfterPlan(id, async () => {});
    const text = listQueue(id)[0].text;
    expect(text).toContain("Work only in this task's repository");
    expect(text).toContain("Don't create worktrees, branches or PRs");
    expect(doneSession).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
  });
});

// The plan of a task whose second piece silently never started.
const EXPERIMENTS = (_api: string, app: string) =>
  `# Plan\n\n## Pieces\n1. Experiments framework: registry, metering  (repo: ${app})\n   owns: migration 85, table experiment_usage, settings keys \`experiments.*\`\n2. Learning cards: signal scripts, cards on finished sessions  (repo: ${app})\n   after: 1 is merged\n   why split: (b) — the framework merges first and the experiment is built on it\n   owns: migration 86, table learning_cards\n`;

describe("a plan that builds as fewer pieces than it listed", () => {
  it("says so to the orchestrator and tells the agent to build the folded work", async () => {
    const { id, api } = task(false, EXPERIMENTS);
    await handoffAfterPlan(id, async () => {});
    const feature = featureOfPlan(id)!;
    expect(feature.listed).toBe(2);
    expect(feature.folded).toMatch(/Learning cards/);
    expect(piecesOf(feature.id)).toHaveLength(1);
    const text = listQueue(id)[0].text;
    expect(text).toContain("Learning cards");
    expect(text).toContain("Nothing else will build them");
    const lines = eventsOf(api.id, id).join("\n");
    expect(lines).toMatch(/listed 2 pieces, building 1/);
    expect(lines).toMatch(/Learning cards folded into 1/);
  });

  it("when it merges the feature closes saying what was folded", async () => {
    const { id, api } = task(false, EXPERIMENTS);
    await handoffAfterPlan(id, async () => {});
    merge(id);
    const { d } = deps();
    await releasePieces(d);
    const done = eventsOf(api.id, id).find((l) => l.includes("is merged"));
    expect(done).toMatch(/plan listed 2/);
    expect(done).toMatch(/Learning cards/);
  });
});

describe("pieces that can't be registered", () => {
  const UNKNOWN = (api: string, app: string) =>
    `# Plan\n\n## Pieces\n1. A: first  (repo: ${app})\n2. B: second  (repo: no-such-repo)\n   why split: (a)\n`;

  it("holds the task for approval and raises an event instead of building on a guess", async () => {
    const { id, api } = task(false, UNKNOWN);
    const send = vi.fn(async () => {});
    await handoffAfterPlan(id, send);
    expect(send).not.toHaveBeenCalled();
    expect(listQueue(id)).toEqual([]);
    expect(
      (
        db.prepare(`SELECT plan_phase FROM sessions WHERE id = ?`).get(id) as {
          plan_phase: string;
        }
      ).plan_phase
    ).toBe("awaiting");
    expect(eventsOf(api.id, id).join("\n")).toMatch(
      /couldn't register its pieces: .*no-such-repo/
    );
    expect(featureOfPlan(id)).toBeUndefined();
    // Approved anyway: built as one piece, and told why.
    await approvePlan(id, undefined, async () => {});
    expect(listQueue(id)[0].text).toContain("couldn't be registered");
  });

  it("holds the task when the Pieces block is unreadable", async () => {
    const { id, api } = task(
      false,
      () => `# Plan\n\n## Pieces\n1. A: first\nsome stray line\n`
    );
    await handoffAfterPlan(id, async () => {});
    expect(listQueue(id)).toEqual([]);
    expect(eventsOf(api.id, id).join()).toMatch(/couldn't be read/);
  });
});

describe("stuck pieces", () => {
  it("one event per merge when the next piece still hasn't started", async () => {
    const { id, feature } = await build();
    merge(id);
    const { BrakeRefused } = await import("../orchestrator/brakes");
    const held = deps({
      start: async () => {
        throw new BrakeRefused("task", "paused");
      },
    }).d;
    const now = Date.now();
    await releasePieces(held, now + 5 * 60_000);
    const stuck = () =>
      pendingEvents(feature.workspace_id).filter((e) =>
        e.key.includes("feature:stuck-")
      );
    expect(stuck()).toHaveLength(0);
    await releasePieces(held, now + 40 * 60_000);
    await releasePieces(held, now + 41 * 60_000);
    expect(stuck()).toHaveLength(1);
    expect(stuck()[0].line).toMatch(/still waiting/);
  });
});

// A feature seeded row by row, with the planning task in `parentProject`.
function seedFeature(
  rows: {
    project: string;
    status: string;
    session?: string | null;
    after?: number;
  }[],
  parentProject: string
) {
  const parent = seedSession({
    projectId: parentProject,
    name: "Share links",
    view: "chat",
    task: true,
  });
  const id = `feat-${parent}`;
  db.prepare(
    `INSERT INTO features (id, workspace_id, name, plan_session_id, plan_text, status)
     VALUES (?, ?, 'Share links', ?, 'plan', 'building')`
  ).run(id, wsOf(parentProject), parent);
  rows.forEach((r, i) =>
    db
      .prepare(
        `INSERT INTO feature_pieces (feature_id, position, name, slice, project_id, after_position, after_kind, status, session_id)
         VALUES (?, ?, ?, 'slice', ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        i + 1,
        `piece-${i + 1}`,
        r.project,
        r.after ?? null,
        r.after ? "merged" : null,
        r.status,
        r.session ?? null
      )
  );
  return { id, parent, workspace: wsOf(parentProject) };
}

const mergeIn = (id: string, project: string, pr: number) =>
  db
    .prepare(
      `UPDATE sessions SET project_id = ?, task_status = 'merged', pr_number = ?, merged_at = datetime('now') WHERE id = ?`
    )
    .run(project, pr, id);

const keys = (workspace: string, part: string) =>
  pendingEvents(workspace).filter((e) => e.key.includes(part));

// A merged task of a piece, in the given project.
function mergedTask(project: string, pr: number) {
  const id = randomUUID();
  seedPieceSession(id);
  mergeIn(id, project, pr);
  return id;
}

// Only the starts of one feature: the database is shared by the whole file.
function depsFor(featureId: string) {
  const { d } = deps();
  const start = d.start;
  const seen: { piece: number; prompt: string }[] = [];
  d.start = async (feature, piece, prompt, sessionId) => {
    const id = await start(feature, piece, prompt, sessionId);
    if (feature.id === featureId) seen.push({ piece: piece.position, prompt });
    return id;
  };
  return { d, started: seen };
}

describe("work the parent already merged", () => {
  it("Share links: the parent's PR is not credited to the other repo's piece, and covers its own", async () => {
    const { app, api } = seedWorkspace();
    // Piece 1 in the other repo carries the parent (the row shape from before
    // pieces were routed by repo); piece 2 is in the parent's repo.
    const f = seedFeature(
      [
        { project: api.id, status: "building" },
        { project: app.id, status: "waiting", after: 1 },
      ],
      app.id
    );
    db.prepare(
      `UPDATE feature_pieces SET session_id = ? WHERE feature_id = ? AND position = 1`
    ).run(f.parent, f.id);
    mergeIn(f.parent, app.id, 289);
    const { d, started } = depsFor(f.id);
    await releasePieces(d);
    await releasePieces(d);
    const [one, two] = piecesOf(f.id);
    expect(one.status).toBe("blocked");
    expect(one.note).toContain("#289");
    expect(prOf(one)).toBeNull();
    expect(two).toMatchObject({ status: "merged", session_id: f.parent });
    expect(two.note).toContain("#289");
    expect(started).toEqual([]);
    expect(keys(f.workspace, "wrong-repo")).toHaveLength(1);
    expect(keys(f.workspace, "parent-built")).toHaveLength(1);
  });

  it("each repo's piece merges in its own task and the parent's PR covers the second", async () => {
    const { app, api } = seedWorkspace();
    const piece1 = mergedTask(api.id, 17);
    const f = seedFeature(
      [
        { project: api.id, status: "building", session: piece1 },
        { project: app.id, status: "waiting", after: 1 },
      ],
      app.id
    );
    mergeIn(f.parent, app.id, 289);
    const { d, started } = depsFor(f.id);
    await releasePieces(d);
    const pieces = piecesOf(f.id);
    expect(pieces.map((p) => p.status)).toEqual(["merged", "merged"]);
    expect(prOf(pieces[0])).toBe(17);
    expect(prOf(pieces[1])).toBe(289);
    expect(started).toEqual([]);
    expect(getFeature(f.id)!.status).toBe("done");
    expect(keys(f.workspace, "done-")[0].line).toContain("2 PRs");
  });

  it("the parent's own piece takes its merge and a later piece in that repo still starts", async () => {
    const { app } = seedWorkspace();
    const f = seedFeature([], app.id);
    db.prepare(
      `INSERT INTO feature_pieces (feature_id, position, name, slice, project_id, status, session_id)
       VALUES (?, 1, 'piece-1', 's', ?, 'building', ?)`
    ).run(f.id, app.id, f.parent);
    db.prepare(
      `INSERT INTO feature_pieces (feature_id, position, name, slice, project_id, after_position, after_kind, status)
       VALUES (?, 2, 'piece-2', 's', ?, 1, 'merged', 'waiting')`
    ).run(f.id, app.id);
    mergeIn(f.parent, app.id, 250);
    const { d, started } = depsFor(f.id);
    await releasePieces(d);
    const [one, two] = piecesOf(f.id);
    expect(one.status).toBe("merged");
    expect(two.status).toBe("building");
    expect(started.map((s) => s.piece)).toEqual([2]);
  });

  it("a scope change on the parent holds the piece instead of crediting it; Release anyway starts it once", async () => {
    const { app, api } = seedWorkspace();
    const piece1 = mergedTask(api.id, 17);
    const f = seedFeature(
      [
        { project: api.id, status: "building", session: piece1 },
        { project: app.id, status: "waiting", after: 1 },
      ],
      app.id
    );
    amendBrief(f.workspace, f.parent, "only the store, not the dialog");
    mergeIn(f.parent, app.id, 289);
    const { d, started } = depsFor(f.id);
    await releasePieces(d);
    await releasePieces(d);
    const two = piecesOf(f.id)[1];
    expect(two.status).toBe("blocked");
    expect(two.note).toContain("#289");
    expect(started).toEqual([]);
    expect(keys(f.workspace, "duplicate-")).toHaveLength(1);
    expect(releaseAnyway(two.id)).toBe(true);
    await releasePieces(d);
    await releasePieces(d);
    expect(started.map((s) => s.piece)).toEqual([2]);
  });

  it("holds a piece whose repo already merged a PR of this feature that no piece accounts for", async () => {
    const { app, api } = seedWorkspace();
    // Piece 1 (api) opened and merged its PR from the app project.
    const stray = mergedTask(app.id, 300);
    const f = seedFeature(
      [
        { project: api.id, status: "building", session: stray },
        { project: app.id, status: "waiting" },
      ],
      api.id
    );
    const { d, started } = depsFor(f.id);
    await releasePieces(d);
    await releasePieces(d);
    const [one, two] = piecesOf(f.id);
    expect(one.status).toBe("blocked");
    expect(two.status).toBe("blocked");
    expect(two.note).toContain("#300");
    expect(started).toEqual([]);
    expect(keys(f.workspace, "duplicate-")).toHaveLength(1);
  });
});

describe("repo names in a plan", () => {
  const dirOf = (name: string) =>
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), "repos-")), name);
  const project = (name: string, dir: string, ws: string) => {
    fs.mkdirSync(dir, { recursive: true });
    const p = createProject({ name, workingDirectory: dir });
    setProjectWorkspace(p.id, ws);
    return p;
  };

  it("resolves by project name, folder name or GitHub repo, case-insensitively", () => {
    const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
    const main = project("AgentOS", dirOf("agent-os"), ws.id);
    const remote = dirOf("some-clone");
    const share = project("Share", remote, ws.id);
    execFileSync("git", ["init", "-q"], { cwd: remote });
    execFileSync(
      "git",
      ["remote", "add", "origin", "git@github.com:Acme/share-api.git"],
      { cwd: remote }
    );
    const ctx = checkContext({ project_id: main.id })!;
    expect(ctx.find("agent-os")?.id).toBe(main.id);
    expect(ctx.find("AGENT-OS")?.id).toBe(main.id);
    expect(ctx.find("agentos")?.id).toBe(main.id);
    expect(ctx.find("acme/share-api")?.id).toBe(share.id);
    expect(ctx.find("share-api")?.id).toBe(share.id);
    expect(ctx.find("nope")).toBeNull();
    const plan = `# Plan\n\n## Pieces\n1. Core: x  (repo: agent-os)\n2. Api: y  (repo: acme/share-api)\n   after: 1 is merged\n   why split: (a)\n`;
    const result = planFor({ project_id: main.id } as Session, plan)!;
    expect(result.errors).toEqual([]);
    expect(result.pieces.map((p) => p.project.id)).toEqual([main.id, share.id]);
  });

  it("refuses a name that fits two projects by folder; a project name wins over a folder", () => {
    const ws = createWorkspace(`ws-${randomUUID().slice(0, 6)}`);
    const a = project("Alpha", dirOf("web"), ws.id);
    project("Beta", dirOf("web"), ws.id);
    expect(checkContext({ project_id: a.id })!.find("web")).toBeNull();
    const named = project("web", dirOf("elsewhere"), ws.id);
    expect(checkContext({ project_id: a.id })!.find("web")?.id).toBe(named.id);
  });
});
