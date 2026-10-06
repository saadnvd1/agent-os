import { execFile } from "child_process";
import { promisify } from "util";
import { checksVerdict, failingCheck, type TaskPR } from "./state";

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
      "number,url,state,headRefOid,statusCheckRollup",
    ],
    repoDir,
    15000
  );
  const [pr] = JSON.parse(out) as Array<{
    number: number;
    url: string;
    state: TaskPR["state"];
    headRefOid?: string;
    statusCheckRollup: Parameters<typeof failingCheck>[0] | null;
  }>;
  if (!pr) return null;
  return {
    number: pr.number,
    url: pr.url,
    state: pr.state,
    checks: checksVerdict(pr.statusCheckRollup ?? []),
    head: pr.headRefOid,
    failing: failingCheck(pr.statusCheckRollup ?? []),
    checkCount: (pr.statusCheckRollup ?? []).length,
  };
}

export async function findPR(
  repoDir: string,
  branch: string
): Promise<TaskPR | null> {
  return findPRStrict(repoDir, branch).catch(() => null);
}
