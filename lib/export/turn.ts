/**
 * One turn as Markdown for the clipboard: the same model and serializer as a
 * session export (build.ts, markdown.ts), redacted for secrets, cut to one turn.
 */

import type { ChatItem } from "../chat/events";
import type { ShareContext } from "../share/redact";
import { BadShare } from "../share/service";
import { buildDoc, type BuildInput, type ExportTurn } from "./build";
import { itemMd } from "./markdown";
import { groupTurns } from "./turns";

export interface TurnCopy {
  /** Reasoning, tool calls and their output, errors and the answer, in order. */
  full: string;
  /** The turn's last agent message. */
  response: string;
}

/** The turn body: every item after the message that began it. */
export function turnMarkdown(turn: ExportTurn): TurnCopy {
  // The first item is the message that began the turn: already on screen.
  const body = turn.userId ? turn.items.slice(1) : turn.items;
  const parts = body.map(itemMd);
  if (turn.ended) parts.push(`*Turn ended early: ${turn.ended}*`);
  if (turn.interrupted) parts.push("*Turn stopped before it finished*");
  const last = [...turn.items].reverse().find((i) => i.kind === "assistant");
  return { full: parts.join("\n\n"), response: last?.text ?? "" };
}

/** The turn that begins with message `startId`. 404 as BadShare. */
export function copyTurn(
  items: ChatItem[],
  startId: string,
  ctx: ShareContext,
  meta: BuildInput["meta"]
): TurnCopy {
  const turn = groupTurns(items).find((t) => t.items[0]?.id === startId);
  if (!turn) throw new BadShare("Turn not found", 404);
  const doc = buildDoc({
    items: turn.items,
    meta,
    mode: "full",
    redact: "secrets",
    ctx,
  });
  return turnMarkdown(doc.turns[0]);
}
