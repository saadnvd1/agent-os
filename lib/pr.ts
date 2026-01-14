import { execSync } from "child_process";

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

/**
 * Check if gh CLI is installed and authenticated
 */
export function checkGhCli(): boolean {
  try {
    execSync("gh auth status", { timeout: 5000, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get commits between current branch and base branch
 */
export function getCommitsSinceBase(
  workingDir: string,
  baseBranch = "main"
): CommitInfo[] {
  try {
    // Get the merge base
    const mergeBase = execSync(`git merge-base ${baseBranch} HEAD`, {
      cwd: workingDir,
      encoding: "utf-8",
    }).trim();

    // Get commits since merge base
    const output = execSync(
      `git log ${mergeBase}..HEAD --format="COMMIT_START%n%H%n%s%n%b%nCOMMIT_END"`,
      {
        cwd: workingDir,
        encoding: "utf-8",
      }
    );

    const commits: CommitInfo[] = [];
    const parts = output.split("COMMIT_START").filter(Boolean);

    for (const part of parts) {
      const lines = part.split("\n").filter((line) => line !== "COMMIT_END");
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
export function getPRForBranch(
  workingDir: string,
  branchName: string
): PRInfo | null {
  try {
    const output = execSync(
      `gh pr list --head "${branchName}" --json number,url,state,title --limit 1`,
      {
        cwd: workingDir,
        encoding: "utf-8",
        timeout: 10000,
      }
    );
    const prs = JSON.parse(output);
    return prs.length > 0 ? prs[0] : null;
  } catch {
    return null;
  }
}

/**
 * Create a new PR
 */
export function createPR(
  workingDir: string,
  branchName: string,
  baseBranch: string,
  title: string,
  body: string
): PRInfo {
  // First ensure branch is pushed
  try {
    execSync(`git push -u origin "${branchName}"`, {
      cwd: workingDir,
      timeout: 30000,
      stdio: "pipe",
    });
  } catch {
    // Branch might already be pushed
  }

  // Create PR using gh CLI
  // Use a temp file for body to handle multiline content safely
  const bodyEscaped = body.replace(/'/g, "'\\''");
  const output = execSync(
    `gh pr create --title '${title.replace(/'/g, "'\\''")}' --base "${baseBranch}" --body '${bodyEscaped}' --json number,url,state,title`,
    {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 30000,
    }
  );
  return JSON.parse(output);
}

/**
 * Get current branch name
 */
export function getCurrentBranch(workingDir: string): string {
  return execSync("git branch --show-current", {
    cwd: workingDir,
    encoding: "utf-8",
  }).trim();
}

/**
 * Get the default base branch (main or master)
 */
export function getBaseBranch(workingDir: string): string {
  try {
    // Try to get from remote HEAD
    const output = execSync(
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo 'refs/heads/main'",
      {
        cwd: workingDir,
        encoding: "utf-8",
      }
    ).trim();
    return output
      .replace("refs/remotes/origin/", "")
      .replace("refs/heads/", "");
  } catch {
    return "main";
  }
}
