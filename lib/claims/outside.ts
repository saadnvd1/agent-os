// Sessions AgentOS didn't start register a claim themselves, through
// `aos claim` or the hook. The CLI sends what git said in its own folder.

import { repoKeyOfRemote } from "../git-remote";
import { machineId, machineName } from "./machine";
import {
  liveClaim,
  newOutsideId,
  releaseOutside,
  upsertOutside,
} from "./store";
import type { Claim, OutsideBody } from "./types";

const self = () => ({ id: machineId(), name: machineName() });

// Null when the remote isn't one a claim can be keyed by, or the id is not
// this machine's outside claim.
export function registerOutside(b: OutsideBody): { claim: Claim } | null {
  const repo = repoKeyOfRemote(b.remote);
  if (!repo) return null;
  const id = b.id ?? newOutsideId();
  const prior = liveClaim(id);
  const ok = upsertOutside(self(), {
    id,
    sessionName: b.name ?? null,
    repo,
    branch: b.branch ?? null,
    base: b.base ?? null,
    goal: b.goal || prior?.goal || "outside session",
    files: b.files,
  });
  const claim = ok ? liveClaim(id) : null;
  return claim ? { claim } : null;
}

export const endOutside = (id: string) => releaseOutside(machineId(), id);
