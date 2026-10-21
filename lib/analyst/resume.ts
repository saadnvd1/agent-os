import { onTurnEnd } from "./onTurnEnd";
import { pushDigest, resendPending } from "./pushDigest";
import { liveLinks } from "./store";
import type { ChatItem } from "../chat/events";
import { FLUSH_MS } from "../chat/store";

// The worker writes a turn's items a moment after reporting its end.
export const SETTLE_MS = 4 * FLUSH_MS;

// The chat registry's hook for every finished turn: read once the items
// have landed. Never throws into the chat path.
export function analystTurnEndHook(
  sessionId: string,
  item: Extract<ChatItem, { kind: "turn_end" }>
): void {
  setTimeout(() => {
    onTurnEnd(sessionId, item).catch((error) =>
      console.error("[analyst] turn end:", error)
    );
  }, SETTLE_MS);
}

// After a restart: digests marked pending go again under their ids (a
// no-op where they landed), and turns that ended while the server was down
// are sent.
export async function resumeAnalystLinks(): Promise<void> {
  for (const link of liveLinks()) {
    try {
      if (link.pendingDigestId) await resendPending(link.id);
      else await pushDigest(link.id);
    } catch (error) {
      console.error(`[analyst] resuming ${link.id}:`, error);
    }
  }
}
