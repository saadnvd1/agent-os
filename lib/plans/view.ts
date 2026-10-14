// Features as the Tasks panel shows them: the plan's name, how far along it
// is, and each piece's state in one line.

import { db } from "../db";
import { piecesOf, prOf, type Feature, type FeaturePiece } from "./features";

export interface PieceView {
  id: number;
  position: number;
  name: string;
  status: FeaturePiece["status"];
  line: string;
  sessionId: string | null;
  prNumber: number | null;
}

export interface FeatureView {
  id: string;
  name: string;
  status: Feature["status"];
  merged: number;
  total: number;
  costUsd: number | null;
  durationMs: number | null;
  // Needs a person: a blocked piece.
  urgent: boolean;
  pieces: PieceView[];
}

const LINE = {
  waiting: (p: FeaturePiece) =>
    p.after_position
      ? `waiting for ${p.after_position} to ${p.after_kind === "deployed" ? "deploy" : "merge"}`
      : "waiting to start",
  building: () => "building",
  merged: (_: FeaturePiece, pr: number | null) =>
    pr ? `#${pr} merged` : "merged",
  blocked: (p: FeaturePiece) => p.note ?? "blocked",
  dropped: (p: FeaturePiece) => p.note ?? "dropped",
};

function pieceView(p: FeaturePiece): PieceView {
  const pr = prOf(p);
  return {
    id: p.id,
    position: p.position,
    name: p.name,
    status: p.status,
    line: LINE[p.status](p, pr),
    sessionId: p.session_id,
    prNumber: pr,
  };
}

export function featureViews(workspaceId?: string | null): FeatureView[] {
  const rows = db
    .prepare(
      `SELECT * FROM features
       WHERE (? IS NULL OR workspace_id = ?)
         AND (status = 'building' OR (status = 'done' AND done_at >= datetime('now', '-3 days')))
       ORDER BY created_at DESC LIMIT 20`
    )
    .all(workspaceId ?? null, workspaceId ?? null) as Feature[];
  return rows.map((f) => {
    const pieces = piecesOf(f.id).map(pieceView);
    const kept = pieces.filter((p) => p.status !== "dropped");
    return {
      id: f.id,
      name: f.name,
      status: f.status,
      merged: kept.filter((p) => p.status === "merged").length,
      total: kept.length,
      costUsd: f.cost_usd,
      durationMs: f.duration_ms,
      urgent: pieces.some((p) => p.status === "blocked"),
      pieces,
    };
  });
}
