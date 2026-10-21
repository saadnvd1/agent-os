import { db } from "../db";
import { lastItems } from "../chat/store";
import { getLink, listRecommendations, liveLinkFor } from "./store";
import type { AnalystLinkView, PaneSession } from "./types";

function pane(id: string): PaneSession {
  const r = db
    .prepare(
      `SELECT id, name, agent_type, model FROM session_rows WHERE id = ?`
    )
    .get(id) as
    | { id: string; name: string; agent_type: string; model: string | null }
    | undefined;
  return {
    id,
    name: r?.name ?? "Ended session",
    agentType: r?.agent_type ?? "claude",
    model: r?.model ?? null,
  };
}

export function linkView(linkId: string): AnalystLinkView | null {
  const link = getLink(linkId);
  if (!link) return null;
  return {
    ...link,
    coder: pane(link.coderSessionId),
    analyst: pane(link.analystSessionId),
    coderLastTurn: lastItems(link.coderSessionId, 1, "turn_end")[0]?.id ?? null,
    recommendations: listRecommendations(link.id),
  };
}

// The live pairing a session is in, as either side.
export function sessionLinkView(sessionId: string): AnalystLinkView | null {
  const link = liveLinkFor(sessionId);
  return link ? linkView(link.id) : null;
}
