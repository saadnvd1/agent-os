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

// The branch's PR, null when it has none; throws when gh can't say.
export async function findPRStrict(
  repoDir: string,
  branch: string
): Promise<TaskPR | null> {
  const out = await run(
    "gh",
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--limit",
      "1",
      "--json",
      "number,url,state,headRefOid,statusCheckRollup,body",
    ],
    repoDir,
    15000
  );
  const [pr] = JSON.parse(out) as Array<{
    number: number;
    url: string;
    state: TaskPR["state"];
    headRefOid?: string;
    statusCheckRollup: RollupEntry[] | null;
    body?: string;
  }>;
  if (!pr) return null;
  const rollup = await settledRollup(
    repoDir,
    pr.url,
    pr.headRefOid,
    pr.statusCheckRollup ?? []
  );
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

// The rollup with stale reruns dropped. Only a check that ran more than once
// costs an API call, one per workflow run. A run outside the PR's repo, or one
// the API can't describe, leaves its check unsettled.
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
    rerunsToLookUp(rollup).map(async ({ repo, id }) => {
      runs.set(
        `${repo}#${id}`,
        repo === prRepo ? await actionsRun(repoDir, repo, id) : null
      );
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
        "{event, headSha: .head_sha, startedAt: .run_started_at}",
      ],
      repoDir,
      15000
    );
    const r = JSON.parse(out) as Partial<ActionsRun>;
    return typeof r.event === "string" &&
      typeof r.headSha === "string" &&
      typeof r.startedAt === "string"
      ? (r as ActionsRun)
      : null;
  } catch {
    return null;
  }
}

export async function findPR(
  repoDir: string,
  branch: string
): Promise<TaskPR | null> {
  return findPRStrict(repoDir, branch).catch(() => null);
}
