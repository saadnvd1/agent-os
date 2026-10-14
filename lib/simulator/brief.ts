import type { ProjectConfig } from "../project-config/schema";
import { simulatorAvailable } from "./available";

// What a task is told about the simulator: nothing when the project declares
// none, one line when this machine can't run one.
export function simulatorBrief(
  sim: ProjectConfig["simulator"],
  available = simulatorAvailable()
): string {
  if (!sim) return "";
  if (!available)
    return "- The iOS simulator tools are not available on this machine; skip simulator checks and say so in the PR.";
  return [
    "- iOS simulator (optional; it never gates a PR or a build, and a failure is reported, not a blocker): `aos sim open` makes your own simulator and installs this worktree's build (run it with run_in_background, a cold build takes minutes; `aos sim status` shows where it is).",
    '  Drive and check state with `aos sim snapshot -i` (accessibility tree with @refs, text, cheap), `aos sim click @e3`, `aos sim fill @e5 "text"`, `aos sim logs --last 2m`. Refs are only valid from the latest snapshot.',
    "  Every image you read stays in your context for every later turn, so screenshot only the final changed screens, and prefer `aos sim screenshot --region @e3` (one element from the latest snapshot) for a single row or banner. It prints two paths: read the `read:` one (reduced to 800px); attach the `full-size` file to the PR.",
    "  Screenshots are written outside the worktree: don't put them in commits or the PR body unless they belong there. `aos sim close` when you're done; it is closed for you when the task ends.",
  ].join("\n");
}
