// How a recipe run's status and trigger read, for every client. Synced to the
// native app, so it may only import synced files.
import type { Tone } from "../config/client-config-types";
import type { RunStatus, RunTriggerKind } from "./types";

export const RUN_STATUS_LABELS: Record<
  RunStatus,
  { label: string; tone: Tone }
> = {
  queued: { label: "Queued", tone: "muted" },
  starting: { label: "Starting", tone: "muted" },
  running: { label: "Running", tone: "muted" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
  blocked: { label: "Needs you", tone: "warning" },
  timed_out: { label: "Timed out", tone: "destructive" },
  cancelled: { label: "Cancelled", tone: "muted" },
  skipped: { label: "Skipped", tone: "warning" },
};

export const RUN_TRIGGER_LABELS: Record<RunTriggerKind, string> = {
  manual: "by hand",
  tool: "by the orchestrator",
  cli: "by an agent",
  timer: "on its timer",
  "catch-up": "on its timer, late",
};
