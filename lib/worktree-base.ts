/**
 * Which ref a new worktree is cut from: the base's tip on origin, fetched
 * first, so a branch this clone has never seen (or a main it hasn't pulled)
 * still works. When the fetch fails the local branch is the fallback.
 */

import * as os from "os";
import { gitOk, gitResult } from "./git-exec";

const FETCH_TIMEOUT_MS = 60_000;
const MAX_FETCH_TIMEOUT_MS = 300_000;

export class BaseUnresolvableError extends Error {
  override readonly name = "BaseUnresolvableError";
  constructor(base: string, why: string | null) {
    super(
      `Base branch "${base}" isn't in this clone or on its origin${why ? ` (${why})` : ""}`
    );
  }
}

// Also the old `git worktree add` text, which a machine on an older AgentOS
// still sends back.
export function isBaseUnresolvable(message: string): boolean {
  return /isn't in this clone or on its origin|invalid reference: /i.test(
    message
  );
}

function fetchTimeout(load = os.loadavg()[0], cores = os.cpus().length || 1) {
  return Math.min(
    MAX_FETCH_TIMEOUT_MS,
    Math.round(FETCH_TIMEOUT_MS * Math.max(1, load / cores))
  );
}

const lastLine = (message: string) =>
  (message.trim().split("\n").pop() ?? "")
    .replace(/^git [\w-]+(?: [\w-]+)? failed: /, "")
    .replace(/^fatal: /, "");

async function hasRef(repo: string, ref: string): Promise<boolean> {
  return gitOk(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    timeout: 10_000,
  });
}

async function hasOrigin(repo: string): Promise<boolean> {
  return gitOk(repo, ["remote", "get-url", "origin"], { timeout: 5_000 });
}

// Fetches the base into origin's tracking ref. Null when it worked.
async function fetchBase(repo: string, base: string): Promise<string | null> {
  const refspec = `+refs/heads/${base}:refs/remotes/origin/${base}`;
  const timeout = fetchTimeout();
  let last = "";
  // Two fetches at once can collide on the ref lock; the second try is clear.
  for (let i = 0; i < 2; i++) {
    try {
      await gitResult(repo, ["fetch", "origin", "--", refspec], { timeout });
      return null;
    } catch (error) {
      last = lastLine(error instanceof Error ? error.message : String(error));
      if (!/cannot lock ref|unable to lock/i.test(last)) break;
    }
  }
  return last || "fetch failed";
}

export interface ResolvedBase {
  // Refs to try, best first.
  refs: string[];
  fetched: boolean;
}

/**
 * `require`: a failed fetch is an error (a session that must not start on
 * stale code) rather than a fall back to what the clone has.
 */
export async function resolveBase(
  repo: string,
  base: string,
  opts: { require?: boolean } = {}
): Promise<ResolvedBase> {
  const local = `refs/heads/${base}`;
  const remote = `refs/remotes/origin/${base}`;
  if (!(await hasOrigin(repo))) {
    if (await hasRef(repo, local)) return { refs: [local], fetched: false };
    throw new BaseUnresolvableError(base, null);
  }
  const failed = await fetchBase(repo, base);
  if (!failed) return { refs: [remote], fetched: true };
  if (opts.require) throw new Error(`Fetching ${base} failed: ${failed}`);
  for (const ref of [local, remote])
    if (await hasRef(repo, ref)) return { refs: [ref], fetched: false };
  throw new BaseUnresolvableError(base, failed);
}
