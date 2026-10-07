// GitHub's rate limits, seen from gh. A rate-limited call backs every gh
// call off until the limit resets, and gh failures are logged (throttled),
// since most callers read a failure as "no answer" and say nothing.

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// While no reset time can be read, or a secondary limit hit.
const DEFAULT_BACKOFF_MS = 60_000;
const LOG_EVERY_MS = 60_000;

let backoffUntil = 0;
const lastLogged = new Map<string, number>();

export class GhBackoffError extends Error {}

export const ghBackedOffUntil = (now = Date.now()) =>
  now < backoffUntil ? backoffUntil : null;

// Throws while backed off, before gh is ever run.
export function assertGhAllowed(args: string[], now = Date.now()): void {
  if (args[0] === "api" && args[1] === "rate_limit") return;
  const until = ghBackedOffUntil(now);
  if (until)
    throw new GhBackoffError(
      `gh is backed off for GitHub's rate limit until ${new Date(until).toISOString()}`
    );
}

// gh's own words, not the command line (which can carry a PR body).
function ghMessage(error: unknown): string {
  const e = error as { stderr?: unknown; message?: unknown };
  const text =
    typeof e?.stderr === "string" && e.stderr.trim()
      ? e.stderr
      : String(e?.message ?? error).replace(/^Command failed:[^\n]*\n?/, "");
  return text.trim().split("\n")[0]?.slice(0, 200) || "failed";
}

export const isRateLimit = (error: unknown) =>
  /rate limit|abuse detection|submitted too quickly/i.test(
    `${(error as { stderr?: unknown })?.stderr ?? ""} ${(error as Error)?.message ?? error}`
  );

// When the exhausted limits reset; null when gh can't say or none is.
async function resetAt(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "gh",
      ["api", "rate_limit", "--jq", ".resources"],
      { timeout: 15000 }
    );
    const resources = JSON.parse(stdout) as Record<
      string,
      { remaining?: number; reset?: number }
    >;
    const resets = Object.values(resources)
      .filter((r) => r.remaining === 0 && typeof r.reset === "number")
      .map((r) => r.reset! * 1000);
    return resets.length ? Math.max(...resets) : null;
  } catch {
    return null;
  }
}

// A gh call failed: log it (once a minute per kind) and, on a rate limit,
// back every gh call off until the reset.
export async function noteGhFailure(
  args: string[],
  error: unknown,
  now = Date.now()
): Promise<void> {
  if (error instanceof GhBackoffError) return;
  const kind = args.slice(0, 2).join(" ");
  if (now - (lastLogged.get(kind) ?? 0) >= LOG_EVERY_MS) {
    lastLogged.set(kind, now);
    console.warn(`[gh] ${kind} failed: ${ghMessage(error)}`);
  }
  if (!isRateLimit(error)) return;
  const until = Math.max((await resetAt()) ?? 0, now + DEFAULT_BACKOFF_MS);
  if (until > backoffUntil) {
    backoffUntil = until;
    console.warn(
      `[gh] rate limited: backing off until ${new Date(until).toISOString()}`
    );
  }
}

// Tests only.
export function resetGhLimit(): void {
  backoffUntil = 0;
  lastLogged.clear();
}
