import { execFileSync } from "child_process";
import { run } from "./tasks/gh";
import { GhBackoffError } from "./tasks/gh-limit";

/** The remote's default branch, or "main" when it has none. */
export function remoteDefaultBranch(workingDir: string): string {
  try {
    return execFileSync(
      "git",
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      {
        cwd: workingDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    )
      .trim()
      .replace(/^origin\//, "");
  } catch {
    return "main";
  }
}

export interface PRInfo {
  number: number;
  url: string;
  state: string;
  title: string;
}

export interface CommitInfo {
  hash: string;
  subject: string;
  body: string;
}

// Every call here waits on git, gh or the network: all of it runs off the
// event loop, so a slow GitHub never stalls the server's other requests.

/**
 * Check if gh CLI is installed and authenticated. Throws GhBackoffError while
 * every gh call waits out GitHub's rate limit: that isn't a missing login.
 */
export async function checkGhCli(): Promise<boolean> {
  try {
    await run("gh", ["auth", "status"], process.cwd(), 5000);
    return true;
  } catch (error) {
    if (error instanceof GhBackoffError) throw error;
    return false;
  }
}

/**
 * Get commits between current branch and base branch
 */
export async function getCommitsSinceBase(
  workingDir: string,
  baseBranch = "main"
): Promise<CommitInfo[]> {
  try {
    // Get the merge base
    // Names come from the repository (its remote's default branch): they
    // are arguments, never shell text or options.
    const mergeBase = (
      await run(
        "git",
        ["merge-base", "--end-of-options", baseBranch, "HEAD"],
        workingDir,
        10_000
      )
    ).trim();

    // Get commits since merge base
    const output = await run(
      "git",
      [
        "log",
        `${mergeBase}..HEAD`,
        "--format=COMMIT_START%n%H%n%s%n%b%nCOMMIT_END",
        "--",
      ],
      workingDir,
      10_000
    );

    const commits: CommitInfo[] = [];
    const parts = output.split("COMMIT_START").filter(Boolean);

    for (const part of parts) {
      // Each block starts on the line after COMMIT_START.
      const lines = part
        .replace(/^\n/, "")
        .split("\n")
        .filter((line) => line !== "COMMIT_END");
      if (lines.length >= 2) {
        const hash = lines[0].trim();
        const subject = lines[1].trim();
        const body = lines.slice(2).join("\n").trim();
        if (hash && subject) {
          commits.push({ hash, subject, body });
        }
      }
    }

    return commits;
  } catch {
    return [];
  }
}

/**
 * Generate PR title from commits
 */
export function generatePRTitle(
  commits: CommitInfo[],
  branchName: string
): string {
  if (commits.length === 0) {
    // Fallback to branch name
    return branchName
      .replace(/^(feature|fix|hotfix|bugfix|chore|docs)\//i, "")
      .replace(/-/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
  }

  if (commits.length === 1) {
    return commits[0].subject;
  }

  // Multiple commits - try to find a common pattern or use the first one
  const firstCommit = commits[0];
  return firstCommit.subject;
}

/**
 * Generate PR body from commits
 */
export function generatePRBody(commits: CommitInfo[]): string {
  if (commits.length === 0) {
    return "## Summary\n\n_No commits yet_\n";
  }

  const lines: string[] = ["## Summary\n"];

  // List all commits
  for (const commit of commits) {
    lines.push(`- ${commit.subject}`);
  }

  lines.push("");
  lines.push("## Changes\n");

  // Add commit bodies if any have meaningful content
  for (const commit of commits) {
    if (commit.body && commit.body.length > 10) {
      lines.push(`### ${commit.subject}\n`);
      lines.push(commit.body);
      lines.push("");
    }
  }

  lines.push("## Test Plan\n");
  lines.push("- [ ] Manual testing completed");
  lines.push("- [ ] Automated tests pass");
  lines.push("");

  return lines.join("\n");
}

/**
 * Get PR for a branch
 */
export async function getPRForBranch(
  workingDir: string,
  branchName: string
): Promise<PRInfo | null> {
  try {
    const output = await run(
      "gh",
      [
        "pr",
        "list",
        "--head",
        branchName,
        "--json",
        "number,url,state,title",
        "--limit",
        "1",
      ],
      workingDir,
      10_000
    );
    const prs = JSON.parse(output);
    return prs.length > 0 ? prs[0] : null;
  } catch (error) {
    // Backed off for the rate limit says nothing about whether a PR exists.
    if (error instanceof GhBackoffError) throw error;
    return null;
  }
}

/**
 * Create a new PR
 */
export async function createPR(
  workingDir: string,
  branchName: string,
  baseBranch: string,
  title: string,
  body: string
): Promise<PRInfo> {
  // First ensure branch is pushed
  try {
    await run(
      "git",
      ["push", "-u", "origin", "--", branchName],
      workingDir,
      30_000
    );
  } catch {
    // Branch might already be pushed
  }

  // Create PR using gh CLI
  // gh pr create outputs the PR URL on success
  const output = await run(
    "gh",
    ["pr", "create", "--title", title, "--base", baseBranch, "--body", body],
    workingDir,
    30_000
  );

  // Parse URL from output (gh pr create prints the URL)
  const urlMatch = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/(\d+)/);
  if (!urlMatch) {
    throw new Error("Failed to parse PR URL from output");
  }

  const url = urlMatch[0];
  const number = parseInt(urlMatch[1], 10);

  return {
    number,
    url,
    state: "open",
    title,
  };
}

/**
 * Get current branch name
 */
export async function getCurrentBranch(workingDir: string): Promise<string> {
  return (
    await run("git", ["branch", "--show-current"], workingDir, 10_000)
  ).trim();
}

/**
 * Get the default base branch: the remote's, or "main" when it has none.
 */
export async function getBaseBranch(workingDir: string): Promise<string> {
  try {
    const ref = await run(
      "git",
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      workingDir,
      10_000
    );
    return ref.trim().replace(/^origin\//, "");
  } catch {
    return "main";
  }
}
