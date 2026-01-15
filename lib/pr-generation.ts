import { execSync } from "child_process";

export interface GeneratedPRContent {
  title: string;
  description: string;
}

/**
 * Generate PR title and description using Claude CLI or fallback heuristics
 */
export async function generatePRContent(
  workingDir: string,
  baseBranch: string = "main"
): Promise<GeneratedPRContent> {
  try {
    // Get git context
    const { diff, commits, changedFiles } = getGitContext(
      workingDir,
      baseBranch
    );

    if (!diff && commits.length === 0) {
      return generateFallbackContent(changedFiles);
    }

    // Try Claude CLI first
    try {
      const result = await generateWithClaude(workingDir, diff, commits);
      if (result) {
        return result;
      }
    } catch (error) {
      console.debug("Claude CLI generation failed, using fallback", error);
    }

    // Fallback to heuristic generation
    return generateHeuristicContent(diff, commits, changedFiles);
  } catch (error) {
    console.error("Failed to generate PR content", error);
    return generateFallbackContent([]);
  }
}

/**
 * Get git context for PR generation
 */
function getGitContext(
  workingDir: string,
  baseBranch: string
): { diff: string; commits: string[]; changedFiles: string[] } {
  let diff = "";
  let commits: string[] = [];
  let changedFiles: string[] = [];

  try {
    // Try to get the remote base branch reference
    let baseBranchRef = baseBranch;
    try {
      execSync(`git rev-parse --verify origin/${baseBranch}`, {
        cwd: workingDir,
        stdio: "pipe",
      });
      baseBranchRef = `origin/${baseBranch}`;
    } catch {
      // Fall back to local branch
      try {
        execSync(`git rev-parse --verify ${baseBranch}`, {
          cwd: workingDir,
          stdio: "pipe",
        });
      } catch {
        // Base branch doesn't exist
        return { diff, commits, changedFiles };
      }
    }

    // Get diff stats
    try {
      diff = execSync(`git diff ${baseBranchRef}...HEAD --stat`, {
        cwd: workingDir,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {}

    // Get changed files
    try {
      const filesOut = execSync(
        `git diff --name-only ${baseBranchRef}...HEAD`,
        {
          cwd: workingDir,
          encoding: "utf-8",
        }
      );
      changedFiles = filesOut
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch {}

    // Get commit messages
    try {
      const commitsOut = execSync(
        `git log ${baseBranchRef}..HEAD --pretty=format:"%s"`,
        {
          cwd: workingDir,
          encoding: "utf-8",
        }
      );
      commits = commitsOut
        .split("\n")
        .map((c) => c.trim())
        .filter(Boolean);
    } catch {}

    // Also include uncommitted changes
    try {
      const workingDiff = execSync("git diff --stat", {
        cwd: workingDir,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
      if (workingDiff) {
        diff = diff ? `${diff}\n${workingDiff}` : workingDiff;
      }

      const uncommittedFiles = execSync("git diff --name-only", {
        cwd: workingDir,
        encoding: "utf-8",
      })
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);

      changedFiles = [...new Set([...changedFiles, ...uncommittedFiles])];
    } catch {}
  } catch (error) {
    console.warn("Failed to get git context", error);
  }

  return { diff, commits, changedFiles };
}

/**
 * Generate PR content using Claude CLI
 */
async function generateWithClaude(
  workingDir: string,
  diff: string,
  commits: string[]
): Promise<GeneratedPRContent | null> {
  // Check if Claude CLI is available
  try {
    execSync("claude --version", { stdio: "pipe", timeout: 5000 });
  } catch {
    return null;
  }

  const prompt = buildPRPrompt(diff, commits);

  try {
    // Use claude CLI with --print flag for non-interactive output
    const output = execSync(`claude --print "${prompt.replace(/"/g, '\\"')}"`, {
      cwd: workingDir,
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    return parseClaudeResponse(output);
  } catch (error) {
    console.debug("Claude CLI invocation failed", error);
    return null;
  }
}

/**
 * Build prompt for PR generation
 */
function buildPRPrompt(diff: string, commits: string[]): string {
  const commitContext =
    commits.length > 0
      ? `Commits:\n${commits.map((c) => `- ${c}`).join("\n")}`
      : "";
  const diffContext = diff
    ? `Diff summary:\n${diff.substring(0, 2000)}${diff.length > 2000 ? "..." : ""}`
    : "";

  return `Generate a concise PR title and description based on these changes:

${commitContext}

${diffContext}

Respond ONLY with valid JSON in this exact format:
{"title": "A concise PR title (max 72 chars)", "description": "A markdown description with ## headers and - bullet points"}`;
}

/**
 * Parse Claude response into PR content
 */
function parseClaudeResponse(response: string): GeneratedPRContent | null {
  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.title && parsed.description) {
        let description = String(parsed.description);
        // Handle escaped newlines
        description = description.replace(/\\n/g, "\n");
        description = description.replace(/\\\\n/g, "\n");
        return {
          title: parsed.title.trim(),
          description: description.trim(),
        };
      }
    }
  } catch (error) {
    console.debug("Failed to parse Claude response", error);
  }
  return null;
}

/**
 * Generate PR content using heuristics
 */
function generateHeuristicContent(
  diff: string,
  commits: string[],
  changedFiles: string[]
): GeneratedPRContent {
  // Use first commit as title
  let title = "chore: update code";
  if (commits.length > 0) {
    title = commits[0];
    if (title.length > 72) {
      title = title.substring(0, 69) + "...";
    }
  } else if (changedFiles.length > 0) {
    const fileName = changedFiles[0].split("/").pop() || "files";
    title = `chore: update ${fileName}`;
  }

  // Build description
  const parts: string[] = [];

  if (commits.length > 0) {
    parts.push("## Changes\n");
    commits.forEach((commit) => parts.push(`- ${commit}`));
  }

  if (changedFiles.length > 0) {
    parts.push("\n## Files Changed\n");
    changedFiles.slice(0, 15).forEach((file) => parts.push(`- \`${file}\``));
    if (changedFiles.length > 15) {
      parts.push(`\n... and ${changedFiles.length - 15} more files`);
    }
  }

  // Parse diff stats
  if (diff) {
    const statsMatch = diff.match(
      /(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/
    );
    if (statsMatch) {
      const fileCount = parseInt(statsMatch[1] || "0", 10);
      const insertions = parseInt(statsMatch[2] || "0", 10);
      const deletions = parseInt(statsMatch[3] || "0", 10);

      if (fileCount > 0 || insertions > 0 || deletions > 0) {
        parts.push("\n## Summary\n");
        if (fileCount > 0) {
          parts.push(
            `- ${fileCount} file${fileCount !== 1 ? "s" : ""} changed`
          );
        }
        const changes: string[] = [];
        if (insertions > 0) changes.push(`+${insertions}`);
        if (deletions > 0) changes.push(`-${deletions}`);
        if (changes.length > 0) {
          parts.push(`- ${changes.join(", ")} lines`);
        }
      }
    }
  }

  const description = parts.join("\n") || "No description available.";
  return { title, description };
}

/**
 * Fallback content when no context available
 */
function generateFallbackContent(changedFiles: string[]): GeneratedPRContent {
  const title =
    changedFiles.length > 0
      ? `chore: update ${changedFiles[0].split("/").pop() || "files"}`
      : "chore: update code";

  const description =
    changedFiles.length > 0
      ? `Updated ${changedFiles.length} file${changedFiles.length !== 1 ? "s" : ""}.`
      : "No changes detected.";

  return { title, description };
}
