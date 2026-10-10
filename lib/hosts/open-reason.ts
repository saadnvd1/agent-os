import { isValidTmuxName } from "./tmux-name";
import type { DiscoveredSession } from "./discover";

/**
 * Why a discovered session can't be opened right now, or null when it can.
 * Shown on the row (disabled, with the reason), never a click that does
 * nothing.
 */
export function openBlockedReason(
  session: Pick<DiscoveredSession, "name" | "hostId">,
  hostErrors: Record<string, string> = {},
  hostName = "That machine"
): string | null {
  const error = hostErrors[session.hostId];
  if (error)
    return /^can't reach/i.test(error)
      ? error
      : `Can't reach ${hostName}: ${error}`;
  if (!isValidTmuxName(session.name))
    return "Its tmux name has characters AgentOS can't attach to";
  return null;
}
