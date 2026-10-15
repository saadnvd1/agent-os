/**
 * Compacting between turns. A chat's agent compacts itself mid-turn at its
 * own, higher window (Claude Code's auto-compact, set at launch by
 * lib/agents/launch). Between turns nothing is in flight, so AgentOS
 * compacts earlier: a chat over the compact threshold is compacted before
 * the next message, and so is one
 * whose prompt cache has expired, since that message would re-read the
 * whole history at the cache-write price (one summary turn, then a small
 * cache write instead of a huge one). The one check every send path uses:
 * the composer to offer it (components/Chat/StaleChip), the chat worker to
 * do it for automated sends (lib/chat/worker/host).
 *
 * Pure, so the browser and the worker read the same rule.
 */

import type { ChatContext, ChatItem, ChatState } from "./events";
import { formatTokens } from "./context";

// How a send treats a stale chat: "auto" compacts first only when it is
// stale (automated sends); "yes" compacts first because the reader chose
// to (the composer's chip). Absent, it never does.
export type CompactFirst = "auto" | "yes";

// The prompt-cache lifetime a turn wrote with, read from its usage: the
// session runs with one or the other, and only a write says which. A turn
// that only read the cache says nothing.
export function cacheTtlMs(
  cacheCreation:
    | {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      }
    | null
    | undefined
): number | undefined {
  if (!cacheCreation) return undefined;
  if ((cacheCreation.ephemeral_1h_input_tokens ?? 0) > 0) return 60 * 60_000;
  if ((cacheCreation.ephemeral_5m_input_tokens ?? 0) > 0) return 5 * 60_000;
  return undefined;
}

export interface Staleness {
  idleMs: number;
  tokens: number;
  // Idle past the cache its last turn wrote, not only over the threshold.
  stale: boolean;
}

// Due a compaction before the next message: no turn running and the
// context above the threshold (0 is off). Null when it isn't, or when the
// chat never said which cache it uses (only Claude's chats do).
export function compactionDue(
  context: ChatContext | null | undefined,
  opts: { state: ChatState; thresholdTokens: number; now?: number }
): Staleness | null {
  if (opts.state === "running" || opts.state === "waiting") return null;
  if (!context?.cacheTtlMs || opts.thresholdTokens <= 0) return null;
  if (context.usedTokens <= opts.thresholdTokens) return null;
  const idleMs = (opts.now ?? Date.now()) - context.at;
  return {
    idleMs,
    tokens: context.usedTokens,
    stale: idleMs > context.cacheTtlMs,
  };
}

export function formatIdle(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 120) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// "Idle 47m · 412k context", or "412k context" while its cache is warm.
export function staleLabel(s: Staleness): string {
  const size = `${formatTokens(s.tokens)} context`;
  return s.stale ? `Idle ${formatIdle(s.idleMs)} · ${size}` : size;
}

// Whether the composer's send compacts first: the chip was showing and the
// reader didn't pick "Skip once". A slash command goes as typed.
export function composerCompacts(
  text: string,
  context: ChatContext | null | undefined,
  opts: { state: ChatState; thresholdTokens: number; asIs: boolean }
): boolean {
  if (opts.asIs || text.trimStart().startsWith("/")) return false;
  return !!compactionDue(context, opts);
}

// The chat's line for a compaction: "Compacted before sending · idle 47m ·
// 412k → 38k tokens" when it ran ahead of a message to a stale chat.
export function compactedLine(
  item: Extract<ChatItem, { kind: "compacted" }>
): string {
  const head =
    item.idleMs !== undefined
      ? `Compacted before sending · idle ${formatIdle(item.idleMs)}`
      : item.trigger === "auto"
        ? "Context compacted automatically"
        : "Context compacted";
  if (item.before === undefined) return head;
  const after = item.after === undefined ? "…" : formatTokens(item.after);
  return `${head} · ${formatTokens(item.before)} → ${after} tokens`;
}
