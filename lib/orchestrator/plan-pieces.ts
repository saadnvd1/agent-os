// plan_pieces: a feature's pieces as text, and the orchestrator's second look
// at the ones still waiting.

import type { Session } from "../db";
import {
  featureOfPlan,
  pieceOfSession,
  getFeature,
  piecesOf,
} from "../plans/features";
import { editWaiting } from "../plans/release";

export function planPiecesText(
  task: Session,
  merge?: number[],
  drop?: number[]
): string {
  const feature =
    featureOfPlan(task.id) ??
    getFeature(pieceOfSession(task.id)?.feature_id ?? "");
  if (!feature) return `${task.name} is a single piece: nothing to edit.`;
  const changes =
    merge?.length || drop?.length
      ? editWaiting(feature.id, { merge, drop })
      : null;
  const lines = piecesOf(feature.id).map((p) => {
    const after = p.after_position
      ? ` after ${p.after_position} is ${p.after_kind}`
      : "";
    const note = p.note ? ` (${p.note})` : "";
    return `${p.position}. ${p.name} [${p.status}]${after}${note}: ${p.slice.split("\n")[0]}`;
  });
  const head = changes
    ? changes.length
      ? `Edited: ${changes.join("; ")}.`
      : "Nothing changed: only waiting pieces can be merged or dropped."
    : null;
  return [head, `Feature "${feature.name}" (${feature.status}):`, ...lines]
    .filter(Boolean)
    .join("\n");
}
