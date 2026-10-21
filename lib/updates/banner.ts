// What the update banner shows, from what the server says and what this
// device has dismissed. Pure, so a native client uses the same rules.

export type UpdatePhase =
  | "starting"
  | "pulling"
  | "installing"
  | "building"
  | "restarting"
  | "done"
  | "built"
  | "failed";

export const ACTIVE_PHASES: readonly UpdatePhase[] = [
  "starting",
  "pulling",
  "installing",
  "building",
  "restarting",
];

export const isActivePhase = (p: UpdatePhase | undefined | null) =>
  !!p && ACTIVE_PHASES.includes(p);

export interface UpdateRun {
  id: string;
  phase: UpdatePhase;
  from: string;
  fromVersion: string;
  toVersion: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  log?: string[];
}

export type UpdateRefusal =
  | "dev"
  | "not_git"
  | "running"
  | "building"
  | "dirty"
  | "branch"
  | "diverged"
  | "up_to_date"
  | "unknown"
  | "no_restart"
  | "forbidden";

export interface UpdateView {
  current: { version: string; sha: string } | null;
  latest: {
    version: string;
    sha: string;
    notes: string[];
    url: string | null;
  } | null;
  available: boolean;
  behind: number;
  status: "ok" | "diverged" | "unknown";
  checkedAt: number | null;
  checkError: string | null;
  bannerEnabled: boolean;
  bannerLocked: boolean;
  /** False when the server has no command to restart itself with. */
  canRestart: boolean;
  canUpdate: { ok: boolean; code?: UpdateRefusal; reason?: string };
  run: UpdateRun | null;
  pending: { requestedAt: number } | null;
  working: { sessions: number; reviews: number; setups: number };
}

export type BannerState =
  "hidden" | "available" | "pending" | "running" | "failed" | "built";

export const DISMISSED_VERSION_KEY = "agentos.update.dismissed";
export const DISMISSED_RUN_KEY = "agentos.update.dismissedRun";

/**
 * A result of something the person started (running, failed, built) always
 * shows until its run is dismissed; "available" is the one that can be
 * switched off or dismissed, and only for the version dismissed.
 */
export function bannerState({
  view,
  dismissedVersion,
  dismissedRun,
}: {
  view: UpdateView | null | undefined;
  dismissedVersion: string | null;
  dismissedRun: string | null;
}): BannerState {
  if (!view) return "hidden";
  const run = view.run;
  if (isActivePhase(run?.phase)) return "running";
  if (run && dismissedRun !== run.id) {
    if (run.phase === "failed") return "failed";
    if (run.phase === "built") return "built";
  }
  if (view.pending) return "pending";
  if (
    view.available &&
    view.bannerEnabled &&
    view.latest &&
    dismissedVersion !== view.latest.version
  )
    return "available";
  return "hidden";
}

export const workingTotal = (w: UpdateView["working"]) =>
  w.sessions + w.reviews + w.setups;
