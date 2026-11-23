import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { db, insertSessionRow } from "@/lib/db";
import { tempDir } from "@/lib/test-temp";
import { collectLocal } from "./collectLocal";
import { liveClaims } from "./store";

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" });
const origin = { id: "self-machine", name: "here" };

function repo(): string {
  const dir = tempDir("ce-");
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "t@example.test");
  sh(dir, "config", "user.name", "t");
  sh(dir, "remote", "add", "origin", "git@git.example.test:team/app.git");
  fs.writeFileSync(path.join(dir, "a.txt"), "x");
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "init");
  sh(dir, "checkout", "-q", "-b", "feature/x");
  fs.writeFileSync(path.join(dir, "b.txt"), "y");
  return dir;
}

const add = (id: string, dir: string, extra: Record<string, unknown> = {}) =>
  insertSessionRow(db, {
    id,
    name: `Task ${id}`,
    tmux_name: `claude-${id}`,
    working_directory: dir,
    ...extra,
  } as Parameters<typeof insertSessionRow>[1]);

beforeEach(() => {
  db.prepare(`DELETE FROM work_claims`).run();
  db.prepare(`DELETE FROM sessions`).run();
});

describe("collectLocal and ended sessions", () => {
  it("releases a session that went to the Done shelf even with a stale open PR", async () => {
    const dir = repo();
    add("s1", dir, { task_status: "running", pr_status: "open" });
    await collectLocal(origin);
    expect(liveClaims()).toHaveLength(1);
    db.prepare(
      `UPDATE sessions SET settled_at = datetime('now') WHERE id = 's1'`
    ).run();
    await collectLocal(origin);
    expect(liveClaims()).toEqual([]);
  });

  it("keeps no paths for a removed worktree", async () => {
    const dir = repo();
    const wt = path.join(tempDir("ce-wt-"), "gone");
    add("s2", dir, { task_status: "running", worktree_path: wt });
    await collectLocal(origin);
    expect(liveClaims()).toEqual([]);
  });
});
