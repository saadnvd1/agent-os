// The /api/updates payload: the cached check, the run, what's pending, and
// whether the caller may start an update.

import { isActivePhase, type UpdateView } from "./banner";
import { cachedCheck, checkForUpdate } from "./check";
import {
  preflight,
  readLog,
  readPending,
  readRun,
  realRunDeps,
  type RunDeps,
} from "./run";
import { bannerEnabled, bannerLocked } from "./settings";

const NOT_ALLOWED =
  "Update from the machine running AgentOS, over Tailscale, or from a device with Can approve.";

const redact = (lines: string[]) =>
  lines.map((l) =>
    l
      .replace(/(https?:\/\/)[^/@\s]+@/g, "$1***@")
      .replace(/\b(gh[pousr]_|github_pat_|npm_|sk-)[\w-]{10,}/g, "***")
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "***")
  );

export async function updateView(
  { mayUpdate }: { mayUpdate: boolean },
  deps: RunDeps = realRunDeps()
): Promise<UpdateView> {
  const stored = readRun(deps);
  let check = cachedCheck(deps.check);
  // An answer from before the update that just finished says the new version
  // is still available; ask again once.
  if (
    check &&
    stored?.finishedAt &&
    (stored.phase === "done" || stored.phase === "built") &&
    check.checkedAt < stored.finishedAt
  )
    check = (await checkForUpdate({ force: true, always: true }, deps.check))
      .result;
  // The log can carry paths and remote URLs; only a device that may update sees it.
  const run =
    stored && (stored.phase === "failed" || stored.phase === "built")
      ? {
          ...stored,
          log: mayUpdate
            ? redact(stored.log?.length ? stored.log : readLog(deps))
            : [],
        }
      : stored;
  const pending = readPending(deps);
  const active = isActivePhase(run?.phase);
  const refusal = mayUpdate ? await preflight(check, deps) : null;
  const canRestart = !!(await deps.restartCommand());
  const wantsWorking = !active && !!(check?.available || pending);
  return {
    current: check?.current ?? null,
    latest: check?.latest ?? null,
    available: !!check?.available,
    behind: check?.behind ?? 0,
    status: check?.status ?? "unknown",
    checkedAt: check?.checkedAt ?? null,
    checkError: check?.error ?? null,
    bannerEnabled: bannerEnabled(deps.env),
    bannerLocked: bannerLocked(deps.env),
    canRestart,
    canUpdate: !mayUpdate
      ? { ok: false, code: "forbidden", reason: NOT_ALLOWED }
      : refusal
        ? { ok: false, code: refusal.code, reason: refusal.error }
        : { ok: true },
    run,
    pending,
    working: wantsWorking
      ? await deps
          .working()
          .catch(() => ({ sessions: 0, reviews: 0, setups: 0 }))
      : { sessions: 0, reviews: 0, setups: 0 },
  };
}
