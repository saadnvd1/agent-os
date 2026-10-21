import { settleSession } from "../sidebar/shelf-state";
import { endLinkRow, getLink, liveLinkFor, setPausedRow } from "./store";
import { AnalystError, type AnalystLink } from "./types";

// Unlinks: the rows stay. The analyst is settled too unless kept.
export function endLink(
  linkId: string,
  opts: { endAnalyst?: boolean } = {}
): AnalystLink {
  const link = getLink(linkId);
  if (!link) throw new AnalystError("Pairing not found", 404);
  if (endLinkRow(link.id) && opts.endAnalyst !== false)
    settleSession(link.analystSessionId);
  return getLink(link.id)!;
}

// A session archived or done: its pairing ends. The analyst of a finished
// coder is settled with it; a finished analyst leaves the coder alone.
export function endLinkOf(sessionId: string): void {
  const link = liveLinkFor(sessionId);
  if (!link) return;
  endLink(link.id, { endAnalyst: link.coderSessionId === sessionId });
}

export function setPaused(linkId: string, paused: boolean): AnalystLink {
  const link = getLink(linkId);
  if (!link) throw new AnalystError("Pairing not found", 404);
  if (link.endedAt) throw new AnalystError("This pairing has ended", 409);
  setPausedRow(link.id, paused);
  return getLink(link.id)!;
}
