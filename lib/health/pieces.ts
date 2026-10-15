/**
 * piece-dup: a plan piece about to start when matching work has already
 * merged. The release guard (lib/plans/release.ts) only knows PRs from the
 * same feature; this reads every merged task in the piece's project since
 * the feature began, so work that merged through a separately started task
 * is seen. Report only: the piece still starts.
 */

import { db } from "../db";
import { close, openAnomalies, recordTrips } from "./store";
import { healthConfig, type HealthConfig } from "./config";
import { matchingMerge, type MergedWork } from "./detectors";
import type { Trip } from "./types";

interface PieceRef {
  id: number;
  name: string;
  slice: string;
  project_id: string;
}

interface FeatureRef {
  id: string;
  name: string;
  workspace_id: string;
  plan_session_id: string;
  created_at: string;
}

export function mergedSince(
  feature: FeatureRef,
  piece: PieceRef,
  ownSessionIds: string[]
): MergedWork[] {
  const own = new Set([feature.plan_session_id, ...ownSessionIds]);
  const since = feature.created_at.includes("T")
    ? feature.created_at
    : `${feature.created_at.replace(" ", "T")}Z`;
  return (
    db
      .prepare(
        `SELECT id, name, pr_number, task_prompt, updated_at FROM session_rows
         WHERE project_id = ? AND task_status = 'merged'
           AND updated_at >= datetime(?)`
      )
      .all(piece.project_id, since) as {
      id: string;
      name: string;
      pr_number: number | null;
      task_prompt: string | null;
    }[]
  )
    .filter((s) => !own.has(s.id))
    .map((s) => ({
      sessionId: s.id,
      prNumber: s.pr_number,
      text: `${s.name} ${(s.task_prompt ?? "").slice(0, 600)}`,
    }));
}

export function duplicateTrip(
  feature: FeatureRef,
  piece: PieceRef,
  merged: MergedWork[],
  c: HealthConfig
): Trip | null {
  const hit = matchingMerge(piece, merged, c.pieceDupOverlap);
  if (!hit) return null;
  const pct = Math.round(hit.score * 100);
  return {
    check: "piece-dup",
    subject: `piece:${piece.id}`,
    severity: "warn",
    line: `Plan piece "${piece.name}" of feature "${feature.name}" is starting, but ${hit.work.prNumber ? `PR #${hit.work.prNumber}` : "a task"} already merged in the same project and shares ${pct}% of its wording.`,
    detail: {
      mergedSession: hit.work.sessionId,
      prNumber: hit.work.prNumber,
      pct,
    },
    workspaceId: feature.workspace_id,
  };
}

// Called as a piece is released. Never throws: it must not hold a start.
export function reportDuplicatePiece(
  feature: FeatureRef,
  piece: PieceRef,
  ownSessionIds: string[],
  now = Date.now()
): void {
  try {
    const c = healthConfig();
    const trip = duplicateTrip(
      feature,
      piece,
      mergedSince(feature, piece, ownSessionIds),
      c
    );
    if (trip) recordTrips([trip], [], now);
  } catch (error) {
    console.error("[health] piece check failed:", error);
  }
}

// A piece that merged or was dropped no longer needs the look.
export function closeResolvedPieces(now: number): number {
  let closed = 0;
  for (const row of openAnomalies()) {
    if (row.check_id !== "piece-dup") continue;
    const id = Number(row.subject.replace("piece:", ""));
    const piece = db
      .prepare(`SELECT status FROM feature_pieces WHERE id = ?`)
      .get(id) as { status: string } | undefined;
    if (!piece || piece.status === "merged" || piece.status === "dropped") {
      close(row.id, "resolved", now);
      closed++;
    }
  }
  return closed;
}
