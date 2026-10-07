/**
 * Claude's conversation file for a session, so a task can resume on another
 * machine: Claude keeps it at ~/.claude/projects/<cwd slug>/<id>.jsonl and
 * --resume only finds it under the slug of the folder it starts in.
 */

import fs from "fs";
import os from "os";
import path from "path";

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isClaudeSessionId = (id: string) => SESSION_ID.test(id);

function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

/** Claude names a project's folder after its cwd, every other character a dash. */
export function claudeProjectDir(cwd: string, root = claudeDir()): string {
  return path.join(root, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
}

export function transcriptPath(cwd: string, sessionId: string): string {
  if (!isClaudeSessionId(sessionId)) throw new Error("Bad Claude session id");
  return path.join(claudeProjectDir(cwd), `${sessionId}.jsonl`);
}

/** The newest conversation started in this folder, when none was recorded. */
export async function latestSessionId(cwd: string): Promise<string | null> {
  const dir = claudeProjectDir(cwd);
  const files = await fs.promises.readdir(dir).catch(() => [] as string[]);
  let best: { id: string; at: number } | null = null;
  for (const file of files) {
    const id = file.replace(/\.jsonl$/, "");
    if (!isClaudeSessionId(id)) continue;
    const at = (await fs.promises.stat(path.join(dir, file))).mtimeMs;
    if (!best || at > best.at) best = { id, at };
  }
  return best?.id ?? null;
}

export async function readTranscript(
  cwd: string,
  sessionId: string
): Promise<string | null> {
  return fs.promises
    .readFile(transcriptPath(cwd, sessionId), "utf8")
    .catch(() => null);
}

const escape = (s: string) => JSON.stringify(s).slice(1, -1);

/**
 * The conversation as the other machine should see it: the worktree's path
 * first (it sits under home), then home itself, each only at a path boundary.
 */
export function rewritePaths(
  text: string,
  from: { cwd: string; home: string },
  to: { cwd: string; home: string }
): string {
  let out = text;
  for (const [a, b] of [
    [from.cwd, to.cwd],
    [from.home, to.home],
  ]) {
    if (a === b) continue;
    const pattern = new RegExp(
      `${escape(a).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[/"\\\\\\s'\`:)]|$)`,
      "g"
    );
    out = out.replace(pattern, escape(b));
  }
  return out;
}

export async function writeTranscript(
  cwd: string,
  sessionId: string,
  text: string
): Promise<void> {
  const file = transcriptPath(cwd, sessionId);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, text, { mode: 0o600 });
}
