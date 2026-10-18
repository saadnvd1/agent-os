import { sessionBaseEnv } from "./agents/server-env";
import { routedRun } from "./models/launch";
import { execFile } from "child_process";
import { git as runGit } from "./git-exec";
import { run } from "./tasks/gh";
import { UNTRUSTED_RULE, untrusted } from "./orchestrator/untrusted";

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
    const { diff, commits, changedFiles } = await getGitContext(
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
async function getGitContext(
  workingDir: string,
  baseBranch: string
): Promise<{ diff: string; commits: string[]; changedFiles: string[] }> {
  let diff = "";
  let commits: string[] = [];
  let changedFiles: string[] = [];

  // Names and text here come from the repository; every one is an
  // argument to git, never shell text or an option.
  const git = (args: string[]) => runGit(workingDir, args, { timeout: 10_000 });
  const lines = (out: string) =>
    out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

  try {
    // Try to get the remote base branch reference
    let baseBranchRef = baseBranch;
    try {
      await git([
        "rev-parse",
        "--verify",
        "--end-of-options",
        `origin/${baseBranch}`,
      ]);
      baseBranchRef = `origin/${baseBranch}`;
    } catch {
      // Fall back to local branch
      try {
        await git(["rev-parse", "--verify", "--end-of-options", baseBranch]);
      } catch {
        // Base branch doesn't exist
        return { diff, commits, changedFiles };
      }
    }
    const range = `${baseBranchRef}...HEAD`;

    try {
      diff = await git(["diff", "--stat", "--end-of-options", range, "--"]);
    } catch {}

    try {
      changedFiles = lines(
        await git(["diff", "--name-only", "--end-of-options", range, "--"])
      );
    } catch {}

    try {
      commits = lines(
        await git([
          "log",
          "--pretty=format:%s",
          "--end-of-options",
          `${baseBranchRef}..HEAD`,
          "--",
        ])
      );
    } catch {}

    // Also include uncommitted changes
    try {
      const workingDiff = await git(["diff", "--stat"]);
      if (workingDiff) {
        diff = diff ? `${diff}\n${workingDiff}` : workingDiff;
      }
      const uncommittedFiles = lines(await git(["diff", "--name-only"]));
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
    await run("claude", ["--version"], workingDir, 5000);
  } catch {
    return null;
  }

  const prompt = buildPRPrompt(diff, commits);

  try {
    // Use claude CLI with --print flag for non-interactive output
    // The prompt goes on stdin: never argv, never a shell.
    const output = await claudePrint(workingDir, prompt);
    return parseClaudeResponse(output);
  } catch (error) {
    console.debug("Claude CLI invocation failed", error);
    return null;
  }
}

// `claude --print` with the prompt on stdin, off the event loop and killed
// at the ceiling.
async function claudePrint(cwd: string, prompt: string): Promise<string> {
  const routed = await routedRun("helper");
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      ["--print", "--model", routed.model],
      {
        cwd,
        env: { ...sessionBaseEnv(), ...routed.env },
        encoding: "utf-8",
        timeout: 30_000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
    // claude exiting before it read the prompt is its failure, not a crash.
    child.stdin?.on("error", () => {});
    child.stdin?.end(prompt);
  });
}

/**
 * Build prompt for PR generation
 */
export function buildPRPrompt(diff: string, commits: string[]): string {
  // Commit subjects and file names are the repository's words, not ours.
  const commitContext =
    commits.length > 0
      ? `Commits:\n${untrusted("commit subjects", commits.map((c) => `- ${c}`).join("\n"))}`
      : "";
  const diffContext = diff
    ? `Diff summary:\n${untrusted("diff stat", `${diff.substring(0, 2000)}${diff.length > 2000 ? "..." : ""}`)}`
    : "";

  return `Generate a concise PR title and description based on these changes:

${UNTRUSTED_RULE}

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
