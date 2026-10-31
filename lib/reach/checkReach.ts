/**
 * gather + classify. The facts are cached: the Connect probe goes out to the
 * internet, so a burst of callers shares one, and a forced fresh check runs
 * at most every 5s.
 */

import { classifyReach } from "./classify";
import { gatherFacts, type GatherDeps } from "./gatherFacts";
import type { ReachFacts, ReachReport, ReachRoute } from "./types";

const CACHE_MS = 30_000;
const FRESH_MIN_MS = 5_000;

let cached: { at: number; facts: ReachFacts } | null = null;
let inflight: Promise<ReachFacts> | null = null;
// The tunnel can be up while the probe through it fails: that failure gets
// its own clock, so it turns into "yours" after a while too.
let probeBadSince: number | null = null;

function ageProbe(f: ReachFacts): ReachFacts {
  if (f.connect.state !== "up" || !f.probe || f.probe.kind === "ok") {
    probeBadSince = null;
    return f;
  }
  probeBadSince ??= f.now;
  return {
    ...f,
    connect: { ...f.connect, downSince: f.connect.downSince ?? probeBadSince },
  };
}

async function facts(fresh: boolean, deps?: GatherDeps): Promise<ReachFacts> {
  if (inflight) return inflight;
  const age = cached ? Date.now() - cached.at : Infinity;
  if (cached && age < (fresh ? FRESH_MIN_MS : CACHE_MS)) return cached.facts;
  inflight = gatherFacts(deps)
    .then((gathered) => {
      const f = ageProbe(gathered);
      cached = { at: Date.now(), facts: f };
      return f;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** `want`: routes the caller means to use, reported even when not set up. */
export async function checkReach(
  fresh = false,
  want: ReachRoute[] = [],
  deps?: GatherDeps
): Promise<ReachReport> {
  return classifyReach(await facts(fresh, deps), want);
}

/** For tests. */
export function resetReachCache() {
  cached = null;
  inflight = null;
  probeBadSince = null;
}
