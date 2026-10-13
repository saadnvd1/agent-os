// Is a newer AgentOS out? Asked of the install's own remote: fetch the
// default branch and compare, so there's no service to depend on and a fork
// or mirror works too. The working tree is never touched.

import { git, GIT_TIMEOUT_MS } from "@/lib/git-exec";
import { getSetting, putSetting, bannerEnabled } from "./settings";
import { isNewer, versionFor } from "./version";

export const CHECK_EVERY_MS = 6 * 60 * 60_000;
export const FORCE_FLOOR_MS = 60_000;
const FIRST_CHECK_MS = 2 * 60_000;
const NOTES_MAX = 8;
const CACHE_KEY = "updates.check";

export interface CheckResult {
  status: "ok" | "diverged" | "unknown";
  current: { version: string; sha: string } | null;
  latest: {
    version: string;
    sha: string;
    notes: string[];
    url: string | null;
  } | null;
  behind: number;
  available: boolean;
  branch: string | null;
  checkedAt: number;
  error: string | null;
}

export interface CheckDeps {
  git: (args: string[]) => Promise<string>;
  now: () => number;
  load: () => CheckResult | null;
  save: (result: CheckResult) => void;
}

export const realDeps = (cwd = process.cwd()): CheckDeps => ({
  git: (args) => git(cwd, args, { timeout: Math.min(GIT_TIMEOUT_MS, 30_000) }),
  now: Date.now,
  load: () => {
    try {
      const raw = getSetting(CACHE_KEY);
      return raw ? (JSON.parse(raw) as CheckResult) : null;
    } catch {
      return null;
    }
  },
  save: (result) => putSetting(CACHE_KEY, JSON.stringify(result)),
});

/** A browsable compare link for a GitHub remote, else null. Credentials are dropped. */
export function compareUrl(
  remote: string,
  from: string,
  to: string
): string | null {
  const m =
    /^(?:https?:\/\/(?:[^/@]+@)?|git@|ssh:\/\/git@)github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(
      remote.trim()
    );
  return m
    ? `https://github.com/${m[1]}/${m[2]}/compare/${from.slice(0, 12)}...${to.slice(0, 12)}`
    : null;
}

const NO_REPO: Omit<CheckResult, "checkedAt"> = {
  status: "unknown",
  current: null,
  latest: null,
  behind: 0,
  available: false,
  branch: null,
  error: null,
};

async function versionAt(
  g: CheckDeps["git"],
  ref: string
): Promise<{ version: string; sha: string }> {
  const [sha, count, pkg] = await Promise.all([
    g(["rev-parse", ref]),
    g(["rev-list", "--count", ref]),
    g(["show", `${ref}:package.json`]),
  ]);
  const version = versionFor(
    (JSON.parse(pkg) as { version?: string }).version ?? "",
    Number(count.trim())
  );
  if (!version) throw new Error("package.json has no version");
  return { version, sha: sha.trim() };
}

/** Fetches the default branch and compares it with HEAD. Throws when git can't say. */
export async function compare(deps: CheckDeps): Promise<CheckResult> {
  const g = deps.git;
  const checkedAt = deps.now();
  if ((await g(["rev-parse", "--is-shallow-repository"])).trim() === "true")
    return {
      ...NO_REPO,
      checkedAt,
      error: "This is a shallow clone, so versions can't be counted.",
    };
  const head = await g(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
    .then((s) => s.trim().replace(/^origin\//, ""))
    .catch(() => "main");
  const branch =
    /^[\w./-]+$/.test(head) && !head.startsWith("-") ? head : "main";
  await g([
    "fetch",
    "-q",
    "origin",
    `+refs/heads/${branch}:refs/remotes/origin/${branch}`,
  ]);
  const remoteRef = `refs/remotes/origin/${branch}`;
  const [current, latest, remote] = await Promise.all([
    versionAt(g, "HEAD"),
    versionAt(g, remoteRef),
    g(["remote", "get-url", "origin"]).catch(() => ""),
  ]);
  const behind = Number(
    (await g(["rev-list", "--count", `HEAD..${remoteRef}`])).trim()
  );
  const fastForward = await g([
    "merge-base",
    "--is-ancestor",
    "HEAD",
    remoteRef,
  ]).then(
    () => true,
    () => false
  );
  const notes =
    behind > 0 && fastForward
      ? (
          await g([
            "log",
            "--first-parent",
            "--format=%s",
            `-n${NOTES_MAX}`,
            `HEAD..${remoteRef}`,
          ])
        )
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const status = behind > 0 && !fastForward ? "diverged" : "ok";
  return {
    status,
    current,
    latest: {
      ...latest,
      notes,
      url: compareUrl(remote, current.sha, latest.sha),
    },
    behind,
    available:
      status === "ok" && behind > 0 && isNewer(latest.version, current.version),
    branch,
    checkedAt,
    error: null,
  };
}

let memo: CheckResult | null = null;
let inflight: Promise<CheckResult> | null = null;

export const resetCheckCache = () => {
  memo = null;
  inflight = null;
};

export function cachedCheck(deps: CheckDeps = realDeps()): CheckResult | null {
  return (memo ??= deps.load());
}

/**
 * The cached answer, or a fresh one when it's older than six hours. `force`
 * asks now, at most once a minute (`throttled`: the seconds left); `always`
 * skips that floor, for a check owed after an update. A failed
 * fetch keeps the last good answer and notes the error.
 */
export async function checkForUpdate(
  { force = false, always = false }: { force?: boolean; always?: boolean } = {},
  deps: CheckDeps = realDeps()
): Promise<{ result: CheckResult; throttled?: number }> {
  const last = cachedCheck(deps);
  const age = last ? deps.now() - last.checkedAt : Infinity;
  if (last && force && !always && age < FORCE_FLOOR_MS)
    return {
      result: last,
      throttled: Math.ceil((FORCE_FLOOR_MS - age) / 1000),
    };
  if (last && !force && age < CHECK_EVERY_MS) return { result: last };
  inflight ??= compare(deps)
    .catch((error: unknown): CheckResult => {
      const message = error instanceof Error ? error.message : String(error);
      return last
        ? { ...last, error: message }
        : { ...NO_REPO, checkedAt: deps.now(), error: message };
    })
    .then((result) => {
      memo = result;
      deps.save(result);
      return result;
    })
    .finally(() => {
      inflight = null;
    });
  return { result: await inflight };
}

/** Dev servers and tests don't check unless asked; AGENTOS_UPDATE_CHECK=off pins it off. */
export function updateChecksEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.AGENTOS_UPDATE_CHECK === "off") return false;
  if (env.AGENTOS_UPDATE_CHECK === "on") return true;
  return env.AGENTOS_DEV !== "1" && env.NODE_ENV === "production";
}

const g = globalThis as unknown as { __agentosUpdateChecks?: NodeJS.Timeout };

/** First check two minutes after boot, then every six hours (jittered). */
export function startUpdateChecks(): void {
  if (g.__agentosUpdateChecks) return;
  const schedule = (delay: number): void => {
    g.__agentosUpdateChecks = setTimeout(async () => {
      try {
        if (bannerEnabled()) await checkForUpdate();
      } catch (error) {
        console.error("Checking for updates failed:", error);
      }
      schedule(CHECK_EVERY_MS + Math.floor(Math.random() * 10 * 60_000));
    }, delay);
    g.__agentosUpdateChecks.unref();
  };
  schedule(FIRST_CHECK_MS);
}
