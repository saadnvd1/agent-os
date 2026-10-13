// Pieces of a feature after the plan is approved: noticing which merged,
// starting the ones whose dependency is met, and closing the feature.

import { randomUUID } from "crypto";
import { db, type Session } from "../db";
import { getProject } from "../projects";
import { loadProjectConfig } from "../project-config";
import { createTask } from "../tasks";
import { startOrQueue } from "../tasks/queue";
import { braked, BrakeRefused } from "../orchestrator/brakes";
import { queueEvent } from "../orchestrator/events";
import { amendBrief } from "../orchestrator/amendments";
import { usageRows } from "../session-logs/gather";
import { pieceBrief } from "./pieces";
import {
  getFeature,
  planPathOf,
  piecesOf,
  type Feature,
  type FeaturePiece,
} from "./features";

export type DependencyState = "ok" | "pending" | "failed";

export interface ReleaseDeps {
  // Whether a merged piece's change is live (for `after: N is deployed`).
  deployed: (dep: FeaturePiece, session: Session) => Promise<DependencyState>;
  start: (
    feature: Feature,
    piece: FeaturePiece,
    prompt: string,
    sessionId: string
  ) => Promise<string>;
  pushFeatureMerged: (feature: Feature) => void;
}

const sessionOf = (id: string | null) =>
  id
    ? (db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
        | Session
        | undefined)
    : undefined;

const setPiece = (id: number, status: string, note: string | null = null) =>
  db
    .prepare(`UPDATE feature_pieces SET status = ?, note = ? WHERE id = ?`)
    .run(status, note, id);

// What a piece's task did: merged, or ended some other way.
function syncPieces(pieces: FeaturePiece[]): void {
  for (const p of pieces) {
    if (p.status !== "building") continue;
    const s = sessionOf(p.session_id);
    if (!s) {
      // Still in the queue, or the queue gave up on it.
      const q = db
        .prepare(`SELECT status, error FROM task_queue WHERE id = ?`)
        .get(p.session_id) as
        | { status: string; error: string | null }
        | undefined;
      if (q?.status === "removed")
        setPiece(p.id, "dropped", "removed from the queue");
      else if (q?.status === "failed")
        setPiece(p.id, "blocked", q.error ?? "it couldn't start");
      continue;
    }
    if (s.task_status === "merged") setPiece(p.id, "merged");
    else if (s.task_status === "dropped" || s.task_status === "done")
      setPiece(p.id, "dropped", `its task was ${s.task_status}`);
  }
}

export const realDeps: ReleaseDeps = {
  // Only a confirmed deploy releases the next piece: anything that can't be
  // checked blocks it (a missing project or PR) or keeps it waiting.
  deployed: async (dep, session) => {
    const project = getProject(dep.project_id);
    if (!project || !session.pr_number || !session.merged_at) return "failed";
    const repo = project.working_directory.replace(
      /^~/,
      process.env.HOME ?? "~"
    );
    const config = loadProjectConfig(repo).config.deploy;
    const { checkDeploy } = await import("../away/deploy");
    const { mergeCommit } = await import("../away/run");
    const verdict = await checkDeploy({
      repo,
      config,
      mergeSha: config ? await mergeCommit(repo, session.pr_number) : null,
      mergedAt: Date.parse(`${session.merged_at}Z`),
      now: Date.now(),
    });
    return verdict.state === "ok"
      ? "ok"
      : verdict.state === "failed"
        ? "failed"
        : "pending";
  },
  start: async (feature, piece, prompt, sessionId) => {
    const plan = sessionOf(feature.plan_session_id);
    const req = {
      projectId: piece.project_id,
      prompt,
      name: `${feature.name} · ${piece.name}`,
      plan: false,
      planReason: "feature piece",
      startedBy: plan?.started_by ?? null,
      originWorkspaceId: feature.workspace_id,
    };
    // A queued task keeps its queue id as its session id once it starts.
    const out = await startOrQueue(req, () =>
      braked(
        feature.workspace_id,
        "task",
        () => createTask({ ...req, id: sessionId }),
        (s) => (s as { id?: string }).id ?? null,
        { spendApproval: false }
      )
    );
    return "queued" in out ? out.queued.id : sessionId;
  },
  pushFeatureMerged: (feature) =>
    void import("../notify/push/events").then((m) =>
      m.pushFeatureMerged(feature.id, feature.name)
    ),
};

function say(feature: Feature, key: string, line: string): void {
  queueEvent(
    feature.workspace_id,
    `feature:${key}`,
    feature.plan_session_id,
    line
  );
}

function beforeLines(all: FeaturePiece[], upTo: number): string[] {
  return all
    .filter((p) => p.position < upTo && p.status === "merged")
    .map((p) => {
      const pr = sessionOf(p.session_id)?.pr_number;
      return `${p.position} ${p.name} merged${pr ? ` as #${pr}` : ""}`;
    });
}

async function releaseOne(
  feature: Feature,
  all: FeaturePiece[],
  piece: FeaturePiece,
  deps: ReleaseDeps
): Promise<void> {
  const dep = piece.after_position
    ? all.find((p) => p.position === piece.after_position)
    : undefined;
  if (dep) {
    if (dep.status === "dropped" || dep.status === "blocked") {
      const note = `waits on ${dep.position} ${dep.name}, which was ${dep.status === "dropped" ? "dropped" : "blocked"}`;
      setPiece(piece.id, "blocked", note);
      say(
        feature,
        `blocked-${piece.id}`,
        `Feature "${feature.name}": piece ${piece.position} ${piece.name} ${note}. Release it anyway or drop it.`
      );
      return;
    }
    if (dep.status !== "merged") return;
    if (piece.after_kind === "deployed") {
      const session = sessionOf(dep.session_id);
      const state = session ? await deps.deployed(dep, session) : "failed";
      if (state === "pending") return;
      if (state === "failed") {
        const note = `${dep.position} ${dep.name} merged but its deploy failed or couldn't be confirmed`;
        setPiece(piece.id, "blocked", note);
        say(
          feature,
          `blocked-${piece.id}`,
          `Feature "${feature.name}": piece ${piece.position} ${piece.name} is held: ${note}.`
        );
        return;
      }
    }
  }
  const claimed = db
    .prepare(
      `UPDATE feature_pieces SET status = 'building', session_id = ?, note = NULL
       WHERE id = ? AND status = 'waiting'`
    )
    .run((piece.session_id = randomUUID()), piece.id).changes;
  if (!claimed) return;
  const prompt = `[Feature "${feature.name}", piece ${piece.position} of ${all.length}, started by AgentOS from an approved plan]\n${pieceBrief(all.length, { position: piece.position, name: piece.name, slice: piece.slice, owns: piece.owns ? piece.owns.split(", ") : [] }, planPathOf(feature.id), beforeLines(all, piece.position))}`;
  try {
    const id = await deps.start(feature, piece, prompt, piece.session_id);
    if (id !== piece.session_id)
      db.prepare(`UPDATE feature_pieces SET session_id = ? WHERE id = ?`).run(
        id,
        piece.id
      );
  } catch (error) {
    // A brake holds it for the next sweep; anything else is told once.
    db.prepare(
      `UPDATE feature_pieces SET status = 'waiting', session_id = NULL WHERE id = ?`
    ).run(piece.id);
    if (!(error instanceof BrakeRefused))
      say(
        feature,
        `start-${piece.id}`,
        `Feature "${feature.name}": piece ${piece.position} ${piece.name} couldn't start: ${error instanceof Error ? error.message : String(error)}`
      );
  }
}

function close(feature: Feature, all: FeaturePiece[], deps: ReleaseDeps): void {
  const live = all.filter((p) => p.status !== "dropped");
  if (!live.length) {
    db.prepare(`UPDATE features SET status = 'dropped' WHERE id = ?`).run(
      feature.id
    );
    return;
  }
  if (live.some((p) => p.status !== "merged")) return;
  const sessions = live
    .map((p) => sessionOf(p.session_id))
    .filter(Boolean) as Session[];
  const cost = sessions.reduce(
    (n, s) => n + usageRows(s.id).reduce((m, r) => m + r.costUsd, 0),
    0
  );
  const ended = Math.max(
    ...sessions.map((s) => (s.merged_at ? Date.parse(`${s.merged_at}Z`) : 0))
  );
  const started = Date.parse(`${feature.created_at}Z`);
  const claimed = db
    .prepare(
      `UPDATE features SET status = 'done', done_at = datetime('now'), cost_usd = ?, duration_ms = ?
       WHERE id = ? AND status = 'building'`
    )
    .run(cost, ended > started ? ended - started : null, feature.id).changes;
  if (!claimed) return;
  say(
    feature,
    `done-${feature.id}`,
    `Feature "${feature.name}" is merged: ${live.length} ${live.length === 1 ? "PR" : "PRs"}.`
  );
  deps.pushFeatureMerged(feature);
}

export async function releasePieces(
  deps: ReleaseDeps = realDeps
): Promise<void> {
  const features = db
    .prepare(`SELECT * FROM features WHERE status = 'building'`)
    .all() as Feature[];
  for (const feature of features) {
    syncPieces(piecesOf(feature.id));
    const all = piecesOf(feature.id);
    for (const piece of all.filter((p) => p.status === "waiting"))
      await releaseOne(feature, piecesOf(feature.id), piece, deps).catch((e) =>
        console.error(`[features] piece ${piece.id}:`, e)
      );
    close(feature, piecesOf(feature.id), deps);
  }
}

// "Release anyway": a blocked piece stops waiting on what held it.
export function releaseAnyway(pieceId: number): boolean {
  return (
    db
      .prepare(
        `UPDATE feature_pieces SET status = 'waiting', after_position = NULL,
           after_kind = NULL, note = NULL WHERE id = ? AND status = 'blocked'`
      )
      .run(pieceId).changes > 0
  );
}

// The orchestrator's second look at a plan while pieces still wait: fold a
// waiting piece into the one before it, or leave it out.
export function editWaiting(
  featureId: string,
  edits: { merge?: number[]; drop?: number[] }
): string[] {
  const done: string[] = [];
  const all = piecesOf(featureId);
  const feature = getFeature(featureId);
  for (const n of [...(edits.drop ?? []), ...(edits.merge ?? [])]) {
    const piece = all.find((p) => p.position === n);
    if (!piece || piece.status !== "waiting" || n < 2 || !feature) continue;
    if (!(edits.merge ?? []).includes(n)) {
      // Pieces that wait on it are then held, not freed.
      setPiece(piece.id, "dropped", "dropped");
      done.push(`${n} dropped`);
      continue;
    }
    const into = all
      .filter((p) => p.position < n && p.status !== "dropped")
      .pop();
    if (!into) continue;
    const slice = `${piece.name}: ${piece.slice}`;
    if (into.status === "waiting")
      db.prepare(
        `UPDATE feature_pieces SET slice = slice || ? WHERE id = ?`
      ).run(`\n${slice}`, into.id);
    else if (into.status === "building" && into.session_id)
      amendBrief(feature.workspace_id, into.session_id, slice);
    else continue;
    setPiece(piece.id, "dropped", `merged into ${into.position}`);
    db.prepare(
      `UPDATE feature_pieces SET after_position = ? WHERE feature_id = ? AND after_position = ?`
    ).run(into.position, featureId, n);
    done.push(`${n} merged into ${into.position}`);
  }
  return done;
}
