import { execFile } from "child_process";
import { promisify } from "util";
import { parseCodeReview } from "./code-review";
import {
  checksVerdict,
  failingCheck,
  rerunsToLookUp,
  settleReruns,
  type ActionsRun,
  type RollupEntry,
  type TaskPR,
} from "./state";

const execFileAsync = promisify(execFile);

export async function run(
  cmd: string,
  args: string[],
  cwd: string,
  timeout = 60000
): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

// The branch's PR in this repository, null when it has none; throws when gh
// can't say. A PR from a fork whose branch has the same name isn't it.
// openOnly: a branch found in the worktree rather than given to the task
// may have been someone's before, so only an open PR counts.
export async function findPRStrict(
  repoDir: string,
  branch: string,
  opts: { openOnly?: boolean } = {}
): Promise<TaskPR | null> {
  const out = await run(
    "gh",
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      opts.openOnly ? "open" : "all",
      "--limit",
      "10",
      "--json",
      "number,url,state,headRefOid,statusCheckRollup,body,isCrossRepository",
    ],
    repoDir,
    15000
  );
  const pr = (
    JSON.parse(out) as Array<{
      number: number;
      url: string;
      state: TaskPR["state"];
      headRefOid?: string;
      statusCheckRollup: RollupEntry[] | null;
      body?: string;
      isCrossRepository?: boolean;
    }>
  ).find((p) => !p.isCrossRepository);
  if (!pr) return null;
  // A closed PR's checks gate nothing, so they cost no API calls.
  const rollup =
    pr.state === "OPEN"
      ? await settledRollup(
          repoDir,
          pr.url,
          pr.headRefOid,
          pr.statusCheckRollup ?? []
        )
      : (pr.statusCheckRollup ?? []);
  return {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    checks: checksVerdict(rollup),
    head: pr.headRefOid,
    failing: failingCheck(rollup),
    checkCount: (pr.statusCheckRollup ?? []).length,
    codeReview: pr.body === undefined ? undefined : parseCodeReview(pr.body),
  };
}

// What the API said about each run attempt. A run's event and commit never
// change and its start changes only with a new attempt, which changes the
// key, so an answer stays good for the life of the process. Failures aren't
// kept, so a rate-limited lookup is retried on the next poll.
const runCache = new Map<string, ActionsRun>();
const RUN_CACHE_MAX = 2000;

// The rollup with stale reruns dropped. Only a check that ran more than once
// costs an API call, one per workflow run attempt. A run outside the PR's
// repo, or one the API can't describe, leaves its check unsettled.
async function settledRollup(
  repoDir: string,
  prUrl: string,
  head: string | undefined,
  rollup: RollupEntry[]
): Promise<RollupEntry[]> {
  const prRepo = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\//.exec(
    prUrl
  )?.[1];
  const runs = new Map<string, ActionsRun | null>();
  await Promise.all(
    rerunsToLookUp(rollup).map(async ({ repo, id, attempt }) => {
      if (repo !== prRepo) return runs.set(`${repo}#${id}`, null);
      const key = attempt && `${repo}#${id}@${attempt}`;
      let info = (key && runCache.get(key)) || null;
      if (!info) {
        info = await actionsRun(repoDir, repo, id);
        if (info && key) {
          if (runCache.size >= RUN_CACHE_MAX) runCache.clear();
          runCache.set(key, info);
        }
      }
      runs.set(`${repo}#${id}`, info);
    })
  );
  return settleReruns(rollup, head, runs);
}

// What started a workflow run, or null when gh can't say.
async function actionsRun(
  repoDir: string,
  repo: string,
  id: string
): Promise<ActionsRun | null> {
  try {
    const out = await run(
      "gh",
      [
        "api",
        `repos/${repo}/actions/runs/${id}`,
        "--jq",
        "{event, headSha: .head_sha, startedAt: .run_started_at, workflowId: .workflow_id}",
      ],
      repoDir,
      15000
    );
    const r = JSON.parse(out) as Partial<ActionsRun>;
    return typeof r.event === "string" &&
      typeof r.headSha === "string" &&
      typeof r.startedAt === "string" &&
      typeof r.workflowId === "number"
      ? (r as ActionsRun)
      : null;
  } catch {
    return null;
  }
}

export async function findPR(
  repoDir: string,
  branch: string,
  opts: { openOnly?: boolean } = {}
): Promise<TaskPR | null> {
  return findPRStrict(repoDir, branch, opts).catch(() => null);
}
