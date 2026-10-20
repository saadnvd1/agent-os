// What a session or the orchestrator reads about an overlap. The other
// claim's goal, machine and paths are another machine's words: fenced.

import { untrusted } from "../orchestrator/untrusted";
import type { SessionOverlap } from "./mine";

const SHOWN = 5;

function where(o: SessionOverlap): string {
  const files = o.shared.slice(0, SHOWN).join(", ");
  const more =
    o.shared.length > SHOWN ? ` and ${o.shared.length - SHOWN} more` : "";
  const what = o.kinds.includes("branch")
    ? "the same branch"
    : "the same files";
  return `${untrusted("claim", `${o.other.goal} on ${o.other.originName}`)} is working on ${what}${files ? `: ${untrusted("claim", files)}${more}` : ""}.`;
}

// The message the local session gets, with the verdict.
export function sessionMessage(o: SessionOverlap): string {
  const head = `Overlap: ${where(o)}`;
  return o.yields
    ? `${head} The other work is closer to merging, so give way: finish your current step, commit, and don't restructure those files further. If your change depends on theirs, say so (BLOCKED: or tell the orchestrator) rather than copy it. Nothing is paused.`
    : `${head} Yours is closer to merging, so keep going; just don't widen into those files. Nothing is paused.`;
}

export function eventLine(o: SessionOverlap, name: string): string {
  return `${name}: overlaps ${where(o)} ${o.yields ? "It yields." : "The other yields."}`;
}

export function mergedMessage(
  winner: { goal: string; originName: string },
  base: string | null
): string {
  return `${untrusted("claim", `${winner.goal} on ${winner.originName}`)} merged, and it overlapped your work. Rebase onto origin/${base ?? "main"} at your next stopping point.`;
}
