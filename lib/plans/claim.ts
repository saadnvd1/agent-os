// A task that builds a waiting piece of a plan claims it, so the release
// sweep never starts that piece a second time.

import { db } from "../db";
import { getProject } from "../projects";
import type { FeaturePiece } from "./features";

export interface WaitingPiece extends FeaturePiece {
  feature_name: string;
}

const COLUMNS = `fp.*, f.name AS feature_name`;

// Waiting pieces in `projectId` of the plans the caller belongs to: the plan
// it wrote, or the one whose piece it is building.
export function waitingPiecesFor(
  callerId: string,
  projectId: string
): WaitingPiece[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM feature_pieces fp JOIN features f ON f.id = fp.feature_id
       WHERE f.status = 'building' AND fp.status = 'waiting' AND fp.project_id = ?
         AND (f.plan_session_id = ?
              OR EXISTS (SELECT 1 FROM feature_pieces o
                         WHERE o.feature_id = f.id AND o.session_id = ?))
       ORDER BY f.created_at, fp.position`
    )
    .all(projectId, callerId, callerId) as WaitingPiece[];
}

// The orchestrator's view: waiting pieces of its workspace's plans.
export function workspacePieces(
  workspaceId: string,
  projectId: string
): WaitingPiece[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM feature_pieces fp JOIN features f ON f.id = fp.feature_id
       WHERE f.status = 'building' AND fp.status = 'waiting' AND fp.project_id = ?
         AND f.workspace_id = ?
       ORDER BY f.created_at, fp.position`
    )
    .all(projectId, workspaceId) as WaitingPiece[];
}

export const listPieces = (waiting: WaitingPiece[]) =>
  waiting.map((p) => `${p.position} ${p.name}`).join(", ");

// `name`, `position`, or `feature/name`; an error that lists what's waiting
// when nothing, or more than one, matches.
export function findPiece(waiting: WaitingPiece[], ref: string): WaitingPiece {
  const want = ref.trim().toLowerCase();
  const slash = want.indexOf("/");
  const only = slash > 0 ? want.slice(0, slash) : null;
  const piece = slash > 0 ? want.slice(slash + 1) : want;
  const hits = waiting.filter(
    (p) =>
      (!only || p.feature_name.toLowerCase() === only) &&
      (p.name.toLowerCase() === piece || String(p.position) === piece)
  );
  if (hits.length === 1) return hits[0];
  const names = waiting
    .map((p) =>
      waiting.some((o) => o.feature_id !== p.feature_id)
        ? `${p.feature_name}/${p.name}`
        : `${p.position} ${p.name}`
    )
    .join(", ");
  if (hits.length > 1)
    throw new Error(
      `"${ref}" matches more than one waiting piece: ${names}. Name it as feature/piece.`
    );
  throw new Error(
    waiting.length
      ? `No waiting piece "${ref}". Waiting pieces: ${names}.`
      : `No waiting piece "${ref}": nothing in your plan is waiting in this project.`
  );
}

export function pieceRefusal(
  waiting: WaitingPiece[],
  projectId: string
): string {
  const where = getProject(projectId)?.name ?? "this project";
  return `Your plan "${waiting[0].feature_name}" has pieces waiting in ${where}: ${listPieces(waiting)}. Name the one this task builds with --piece <name>; AgentOS starts the others itself when they are due.`;
}

export function pieceStatus(id: number): string | undefined {
  return (
    db.prepare(`SELECT status FROM feature_pieces WHERE id = ?`).get(id) as
      | { status: string }
      | undefined
  )?.status;
}

export function claimable(id: number): void {
  const status = pieceStatus(id);
  if (status !== "waiting")
    throw new Error(`That piece is ${status ?? "gone"}, not waiting`);
}

// Synchronous, so nothing runs between the check and the write.
export function claimPiece(id: number, sessionId: string): void {
  const changed = db
    .prepare(
      `UPDATE feature_pieces SET status = 'building', session_id = ?, note = NULL
       WHERE id = ? AND status = 'waiting'`
    )
    .run(sessionId, id).changes;
  if (!changed)
    throw new Error(`That piece is ${pieceStatus(id) ?? "gone"}, not waiting`);
}

// Gives a claim back when the session it was made for never came to be.
export function releaseClaim(id: number, sessionId: string): void {
  db.prepare(
    `UPDATE feature_pieces SET status = 'waiting', session_id = NULL
     WHERE id = ? AND session_id = ? AND status = 'building'`
  ).run(id, sessionId);
}

export function pieceLabel(id: number): string {
  const r = db
    .prepare(
      `SELECT fp.position, fp.name, f.name AS feature FROM feature_pieces fp
       JOIN features f ON f.id = fp.feature_id WHERE fp.id = ?`
    )
    .get(id) as { position: number; name: string; feature: string } | undefined;
  return r ? `piece ${r.position} ${r.name} of "${r.feature}"` : "a piece";
}
