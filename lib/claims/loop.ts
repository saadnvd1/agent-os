import { collectLocal } from "./collectLocal";
import { selfMachine, syncPeers } from "./exchange";
import { claimsShared } from "./machine";
import { notifyOverlaps } from "./notifyOverlaps";
import { handleMerged } from "./onMerged";
import { purgeExpired } from "./store";
import { CLAIMS_SYNC_MS } from "./types";

export async function claimsTick(
  log: (line: string) => void = () => {}
): Promise<void> {
  if (!claimsShared()) return;
  try {
    await collectLocal(selfMachine());
    await syncPeers(log);
    await notifyOverlaps();
    await handleMerged();
    purgeExpired();
  } catch (err) {
    log(`claims: ${(err as Error)?.message ?? err}`);
  }
}

// One tick a minute. Nothing here may throw into the server.
export function startClaimsLoop(
  log: (line: string) => void = (l) => console.log(l)
): { stop: () => void } {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const next = () => {
    if (stopped) return;
    timer = setTimeout(run, CLAIMS_SYNC_MS);
    timer.unref?.();
  };
  const run = async () => {
    await claimsTick(log);
    next();
  };
  timer = setTimeout(run, 5000);
  timer.unref?.();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
