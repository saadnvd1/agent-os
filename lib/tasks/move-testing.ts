// Test fixtures for moving tasks: a real origin and clone under a temp HOME,
// and running task sessions with an uncommitted change and a conversation.
// Tests mock ../worktrees (WORKTREES_DIR), ../env-setup and ../agents/launch.

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db, insertSessionRow, type Session } from "../db";
import { createProject } from "../projects";
import { writeTranscript } from "./transcript";
import { gitSync } from "../git-exec";
import { tempDir } from "@/lib/test-temp";

export const CLAUDE_ID = "11111111-2222-3333-4444-555555555555";

export const git = (cwd: string, ...args: string[]) =>
  gitSync(cwd, args).trim();

export const row = (id: string) =>
  db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as Session;

export interface MoveFixture {
  tmp: string;
  origin: string;
  repo: string;
  projectId: string;
  restore: () => void;
}

/** HOME, Claude's folder and git identity all point into a temp dir. */
export function setupMoveRepo(): MoveFixture {
  const saved = { HOME: process.env.HOME };
  const tmp = tempDir("aos-move-");
  process.env.HOME = tmp;
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, ".claude");
  for (const who of ["AUTHOR", "COMMITTER"]) {
    process.env[`GIT_${who}_NAME`] = "Test";
    process.env[`GIT_${who}_EMAIL`] = "test@example.com";
  }
  const origin = path.join(tmp, "origin.git");
  git(tmp, "init", "-q", "--bare", "-b", "main", origin);
  const repo = path.join(tmp, "dev", "app");
  git(tmp, "clone", "-q", origin, repo);
  fs.writeFileSync(path.join(repo, "README.md"), "app\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "push", "-q", "origin", "HEAD:main");
  const projectId = createProject({
    name: "app",
    workingDirectory: "~/dev/app",
  }).id;
  return {
    tmp,
    origin,
    repo,
    projectId,
    restore: () => {
      process.env.HOME = saved.HOME;
      delete process.env.CLAUDE_CONFIG_DIR;
      fs.rmSync(tmp, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}

export async function seedTask(
  f: MoveFixture,
  worktrees: string,
  branch: string
): Promise<{ id: string; cwd: string }> {
  const cwd = path.join(worktrees, `app-${branch.replace(/\W/g, "-")}`);
  git(f.repo, "worktree", "add", "-q", "-b", branch, cwd, "main");
  fs.writeFileSync(path.join(cwd, "work.txt"), "half done\n");
  const id = randomUUID();
  insertSessionRow(db, {
    id,
    name: "Fix it",
    tmux_name: `claude-${id}`,
    working_directory: cwd,
    project_id: f.projectId,
    task_status: "running",
    task_prompt: "fix the thing",
    branch_name: branch,
    worktree_path: cwd,
    base_branch: "main",
    claude_session_id: CLAUDE_ID,
    model: "sonnet",
  });
  await writeTranscript(
    cwd,
    CLAUDE_ID,
    JSON.stringify({ cwd, text: `read ${cwd}/work.txt` }) + "\n"
  );
  return { id, cwd };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
