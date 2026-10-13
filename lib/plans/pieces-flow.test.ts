import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { retireChat } = vi.hoisted(() => ({
  retireChat: vi.fn(async () => {}),
}));
vi.mock("../chat/runner", () => ({ retireChat, sendQueuedNow: vi.fn() }));

import { db } from "../db";
import { listQueue } from "../chat/queued";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { amendmentsOf } from "../orchestrator/amendments";
import { pendingEvents } from "../orchestrator/events";
import {
  PLAN_FILE,
  approvePlan,
  handoffAfterPlan,
  implementPrompt,
  preparePlanDir,
} from "../models/plan-step";
import { recordTurn } from "../usage/turns";
import {
  featureOfPlan,
  pieceOfSession,
  piecesOf,
  reviewGoal,
} from "./features";
import { editWaiting, releaseAnyway, releasePieces } from "./release";
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

function task(planOnly: boolean, planText: (api: string) => string) {
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
  fs.writeFileSync(path.join(worktree, PLAN_FILE), planText(api.name));
  return { id, app, api };
}

const TWO = (api: string) =>
  `# Plan\n\n## Pieces\n1. Core: the engine  (repo: ${"app"})\n   owns: migration 80\n2. Hooks: the client  (repo: ${api})\n   after: 1 is merged\n   why split: (a)\n`;

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
