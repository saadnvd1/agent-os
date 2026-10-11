/**
 * After a merge, did the deploy land and the server come back healthy? Read
 * from the project's `deploy` config (agentos.json): the file its deploy
 * writes the deployed commit to (scripts/autodeploy's `deployed`), the file
 * it writes a commit whose deploy failed to (`alerted`), and a health URL.
 * A project without one isn't checked; a missing `deployed` file means no
 * deploy runs on this machine, which isn't a failure either.
 */

import fs from "fs";
import type { ProjectConfig } from "../project-config";
import { run } from "../tasks/gh";
import { expandHome } from "../tasks/session";
import { selfUrl } from "../agents/self-env";

export type DeployConfig = NonNullable<ProjectConfig["deploy"]>;

export type DeployVerdict =
  | { state: "ok"; detail: string }
  | { state: "failed"; detail: string }
  | { state: "pending" }
  | { state: "unchecked"; detail: string };

export const DEPLOY_WITHIN_MIN = 30;
// After the deploy lands, the server gets this long to answer healthy.
export const HEALTH_GRACE_MS = 3 * 60 * 1000;

export interface DeployDeps {
  // The commit a state file names, or null when there's no such file.
  readSha: (file: string) => { sha: string; at: number } | null;
  // Whether `sha` is in the history of `tip` (fetching it if need be).
  contains: (repo: string, tip: string, sha: string) => Promise<boolean>;
  health: (url: string) => Promise<{ ok: boolean; why?: string }>;
}

const SHA = /^[0-9a-f]{40}$/;

function readSha(file: string): { sha: string; at: number } | null {
  try {
    const full = expandHome(file);
    const sha = fs.readFileSync(full, "utf-8").slice(0, 80).trim();
    return SHA.test(sha) ? { sha, at: fs.statSync(full).mtimeMs } : null;
  } catch {
    return null;
  }
}

async function contains(
  repo: string,
  tip: string,
  sha: string
): Promise<boolean> {
  if (tip === sha) return true;
  const ancestor = () =>
    run("git", ["merge-base", "--is-ancestor", sha, tip], repo).then(
      () => true,
      () => false
    );
  if (await ancestor()) return true;
  // The deployed commit may be newer than this checkout knows.
  await run("git", ["fetch", "--quiet", "origin"], repo).catch(() => {});
  return ancestor();
}

async function health(url: string): Promise<{ ok: boolean; why?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok ? { ok: true } : { ok: false, why: `HTTP ${res.status}` };
  } catch (error) {
    return {
      ok: false,
      why: error instanceof Error ? error.message : String(error),
    };
  }
}

export const DEFAULT_DEPS: DeployDeps = { readSha, contains, health };

// A path alone is this AgentOS server's own.
export const healthUrl = (health: string) =>
  health.startsWith("/") ? `${selfUrl()}${health}` : health;

export async function checkDeploy(
  input: {
    repo: string;
    config: DeployConfig | undefined;
    mergeSha: string | null;
    mergedAt: number;
    now: number;
  },
  deps: DeployDeps = DEFAULT_DEPS
): Promise<DeployVerdict> {
  const { config, mergeSha } = input;
  if (!config)
    return { state: "unchecked", detail: "no deploy check configured" };
  if (!mergeSha) return { state: "pending" };
  const short = mergeSha.slice(0, 7);
  const deployed = deps.readSha(config.deployed);
  if (!deployed)
    return { state: "unchecked", detail: "no deploy runs on this machine" };

  if (await deps.contains(input.repo, deployed.sha, mergeSha)) {
    if (!config.health) return { state: "ok", detail: `${short} deployed` };
    const url = healthUrl(config.health);
    const answer = await deps.health(url);
    if (answer.ok)
      return { state: "ok", detail: `${short} deployed, server healthy` };
    if (input.now - deployed.at < HEALTH_GRACE_MS) return { state: "pending" };
    return {
      state: "failed",
      detail: `${short} deployed, but ${config.health} didn't answer healthy: ${answer.why ?? "no answer"}`,
    };
  }

  const failed = config.failed ? deps.readSha(config.failed) : null;
  if (failed && (await deps.contains(input.repo, failed.sha, mergeSha)))
    return {
      state: "failed",
      detail: `the deploy of ${failed.sha.slice(0, 7)} (which has ${short}) failed; see the deploy's log`,
    };
  const within = (config.within_minutes ?? DEPLOY_WITHIN_MIN) * 60 * 1000;
  if (input.now - input.mergedAt >= within)
    return {
      state: "failed",
      detail: `${short} not deployed ${Math.round(within / 60000)} minutes after the merge`,
    };
  return { state: "pending" };
}
