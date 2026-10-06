/**
 * One-shot Claude runs in a fresh process, for checks that must not share
 * anything with the session being checked, nor run anything the checked
 * code ships: `claude -p` with its own system prompt, no settings from any
 * source (so no hooks, MCP servers or allow rules from the repository under
 * review, nor the user's), no MCP config but its own, an allowlisted
 * environment, only the tools named, everything else refused without
 * asking, and a JSON schema for the answer.
 */

import { spawn } from "child_process";

export interface ClaudeRun {
  cwd: string;
  system: string;
  prompt: string;
  schema: object;
  // Built-in tools it may see at all; [] for none.
  tools: string[];
  // Permission rules within those, e.g. "Bash(git diff:*)".
  allow?: string[];
  timeoutMs?: number;
}

export type ClaudeRunner = (run: ClaudeRun) => Promise<unknown>;

const MODEL = process.env.AGENTOS_REVIEW_MODEL;

// All a check's process gets from the server's environment: enough to run
// and to sign in to Claude, nothing else.
const ENV_ALLOW = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
];

export function checkEnv(
  from: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const k of ENV_ALLOW) if (from[k] !== undefined) env[k] = from[k];
  return env as NodeJS.ProcessEnv;
}

export function claudeArgs(run: ClaudeRun): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--no-session-persistence",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--permission-mode",
    "dontAsk",
    "--system-prompt",
    run.system,
    "--tools",
    run.tools.join(","),
    ...(run.allow?.length ? ["--allowedTools", ...run.allow] : []),
    "--disallowedTools",
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    "Bash",
    "WebFetch",
    "WebSearch",
    "--json-schema",
    JSON.stringify(run.schema),
    ...(MODEL ? ["--model", MODEL] : []),
  ];
}

// The structured answer, or throws with what went wrong.
export const runClaude: ClaudeRunner = (run) =>
  new Promise((resolve, reject) => {
    const child = spawn("claude", claudeArgs(run), {
      cwd: run.cwd,
      env: checkEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(
      () => {
        child.kill("SIGTERM");
        reject(new Error("The check took too long and was stopped"));
      },
      run.timeoutMs ?? 15 * 60 * 1000
    );
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const result = JSON.parse(out) as {
          is_error?: boolean;
          result?: string;
          structured_output?: unknown;
        };
        if (result.is_error || result.structured_output === undefined)
          throw new Error(result.result || "No answer");
        resolve(result.structured_output);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        reject(new Error(`claude -p failed: ${why} ${err.slice(-300)}`.trim()));
      }
    });
    child.stdin.end(run.prompt);
  });
