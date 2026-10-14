import { brakesEnabled } from "../orchestrator/brakes";
import { isPaused } from "../orchestrator/pause";
import { readUsage, windowRefusal } from "../orchestrator/usage";
import type { Hold } from "./schedule";

// Why an automatic start has to wait, or null. A start now by a person
// isn't held.
export function autoHold(
  workspaceId: string | null,
  planOnly = false
): Hold | null {
  if (workspaceId && isPaused(workspaceId))
    return { code: "orch_paused", text: "Waiting: the orchestrator is paused" };
  if (planOnly) return null;
  const window = brakesEnabled() ? windowRefusal(readUsage()) : null;
  return window ? { code: "window", text: `Waiting: ${window}` } : null;
}
