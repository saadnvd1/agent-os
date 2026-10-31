// What the update banner shows, from what the server says and what this
// device has dismissed. Pure, so a native client uses the same rules.

export type UpdatePhase =
  | "starting"
  | "backing_up"
  | "pulling"
  | "installing"
  | "building"
  | "restarting"
  | "verifying"
  | "rolling_back"
  | "done"
  | "built"
  | "rolled_back"
  | "failed";

export const ACTIVE_PHASES: readonly UpdatePhase[] = [
  "starting",
  "backing_up",
  "pulling",
  "installing",
  "building",
  "restarting",
  "verifying",
  "rolling_back",
];

/** How a finished run ended; written by scripts/update-run.mjs. */
export type UpdateOutcome =
  "done" | "build_failed" | "rolled_back" | "broken" | "interrupted";

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
  /** Started by automatic updates, not by someone. */
  auto?: boolean;
  /** The commit it updates to. */
  to?: string;
  outcome?: UpdateOutcome;
  /** How far redeploy got: pulled, deps_swapped, build_swapped. */
  stage?: string;
  /** The runner's heartbeat and pid, so a cut-off run is told from a slow one. */
  updatedAt?: number;
  pid?: number;
}

/** One finished update, kept in the history Settings shows. */
export interface UpdateAttempt {
  id: string;
  from: string;
  to: string;
  fromVersion: string;
  toVersion: string;
  auto: boolean;
  startedAt: number;
  finishedAt: number;
  outcome: UpdateOutcome;
  error?: string;
}

/** The idle times Settings offers for automatic updates. */
export const IDLE_MINUTES = [5, 10, 15, 30, 60] as const;

/** What automatic updates are doing, for Settings. */
export interface AutoUpdateView {
  enabled: boolean;
  locked: boolean;
  managed: boolean;
  idleMinutes: number;
  idleLocked: boolean;
  status: { code: string; text: string } | null;
  attempts: UpdateAttempt[];
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
  | "disk"
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
  auto?: AutoUpdateView;
}

export type BannerState =
  | "hidden"
  | "available"
  | "pending"
  | "running"
  | "failed"
  | "built"
  | "updated"
  | "rolled_back";

export const DISMISSED_VERSION_KEY = "agentos.update.dismissed";
export const DISMISSED_RUN_KEY = "agentos.update.dismissedRun";

/**
 * A result of something the person started (running, failed, built) always
 * shows until its run is dismissed; "available" is the one that can be
 * switched off or dismissed, and only for the version dismissed. An
 * automatic update says it happened ("updated") or that it was rolled back;
 * an automatic one that failed to build changed nothing, so only Settings
 * shows it, unless it left the server broken.
 */
export const UPDATED_NOTE_MS = 3 * 24 * 60 * 60_000;

export function bannerState({
  view,
  dismissedVersion,
  dismissedRun,
  now = Date.now(),
}: {
  view: UpdateView | null | undefined;
  dismissedVersion: string | null;
  dismissedRun: string | null;
  now?: number;
}): BannerState {
  if (!view) return "hidden";
  const run = view.run;
  if (isActivePhase(run?.phase)) return "running";
  if (run && dismissedRun !== run.id) {
    if (run.phase === "rolled_back") return "rolled_back";
    if (run.phase === "failed" && (!run.auto || run.outcome === "broken"))
      return "failed";
    if (run.phase === "built") return "built";
    // A device that wasn't open for days doesn't need the news.
    if (
      run.phase === "done" &&
      run.auto &&
      view.bannerEnabled &&
      now - (run.finishedAt ?? 0) < UPDATED_NOTE_MS
    )
      return "updated";
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
