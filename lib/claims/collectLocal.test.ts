import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { db, insertSessionRow } from "@/lib/db";
import { collectLocal } from "./collectLocal";
import { liveClaims } from "./store";
import { tempDir } from "@/lib/test-temp";

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe" });

function repo(): string {
  const dir = tempDir("r-");
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "t@example.test");
  sh(dir, "config", "user.name", "t");
  sh(dir, "remote", "add", "origin", "git@git.example.test:team/app.git");
  fs.writeFileSync(path.join(dir, ".gitignore"), "*.log\n");
  fs.writeFileSync(path.join(dir, "base.txt"), "x");
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "init");
  return dir;
}

function session(id: string, dir: string, extra: Record<string, unknown> = {}) {
  insertSessionRow(db, {
    id,
    name: `Task ${id}`,
    tmux_name: `claude-${id}`,
    working_directory: dir,
    ...extra,
  } as Parameters<typeof insertSessionRow>[1]);
}

const origin = { id: "self-machine", name: "here" };

beforeEach(() => {
  db.prepare(`DELETE FROM work_claims`).run();
  db.prepare(`DELETE FROM sessions`).run();
});

describe("collectLocal", () => {
  it("claims the branch with committed and untracked paths, not ignored ones", async () => {
    const dir = repo();
    sh(dir, "checkout", "-q", "-b", "feature/x");
    fs.mkdirSync(path.join(dir, "lib"));
    fs.writeFileSync(path.join(dir, "lib", "a.ts"), "1");
    sh(dir, "add", "-A");
    sh(dir, "commit", "-q", "-m", "a");
    fs.writeFileSync(path.join(dir, "b.ts"), "2");
    fs.writeFileSync(path.join(dir, "debug.log"), "3");
    session("s1", dir);
    await collectLocal(origin);
    const [c] = liveClaims();
    expect(c).toMatchObject({
      repo: "git.example.test/team/app",
      branch: "feature/x",
      sessionId: "s1",
    });
    expect([...c.files].sort()).toEqual(["b.ts", "lib/a.ts"]);
  });

  it("ignores dependency staging folders", async () => {
    const dir = repo();
    sh(dir, "checkout", "-q", "-b", "feature/z");
    fs.mkdirSync(path.join(dir, "node_modules.aos-partial", ".pnpm"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(dir, "node_modules.aos-partial", "x"), "1");
    fs.writeFileSync(
      path.join(dir, "node_modules.aos-partial", ".pnpm", "lock.yaml"),
      "1"
    );
    fs.writeFileSync(path.join(dir, "real.ts"), "2");
    session("s3", dir);
    await collectLocal(origin);
    expect([...liveClaims()[0].files]).toEqual(["real.ts"]);
  });

  it("drops generated files, tracked or untracked", async () => {
    const dir = repo();
    fs.mkdirSync(path.join(dir, "scripts", "__pycache__"), { recursive: true });
    const pyc = path.join(dir, "scripts", "__pycache__", "x.cpython-312.pyc");
    fs.writeFileSync(pyc, "1");
    sh(dir, "add", "-A");
    sh(dir, "commit", "-q", "-m", "pyc");
    sh(dir, "checkout", "-q", "-b", "feature/py");
    fs.writeFileSync(pyc, "2");
    fs.writeFileSync(path.join(dir, "scripts", "__pycache__", "y.pyc"), "3");
    fs.writeFileSync(path.join(dir, "real.py"), "4");
    session("s4", dir);
    await collectLocal(origin);
    expect([...liveClaims()[0].files]).toEqual(["real.py"]);
  });

  it("skips a shell idle on the default branch and a folder with no remote", async () => {
    const dir = repo();
    session("idle", dir);
    const bare = tempDir("n-");
    sh(bare, "init", "-q", "-b", "main");
    session("noremote", bare);
    await collectLocal(origin);
    expect(liveClaims()).toHaveLength(0);
  });

  it("releases the claim once the session is gone", async () => {
    const dir = repo();
    sh(dir, "checkout", "-q", "-b", "feature/y");
    fs.writeFileSync(path.join(dir, "n.ts"), "1");
    session("s2", dir);
    await collectLocal(origin);
    expect(liveClaims()).toHaveLength(1);
    db.prepare(`DELETE FROM sessions WHERE id = 's2'`).run();
    await collectLocal(origin);
    expect(liveClaims()).toHaveLength(0);
  });

  it("leaves a linked machine's mirror out", async () => {
    const dir = repo();
    sh(dir, "checkout", "-q", "-b", "feature/z");
    fs.writeFileSync(path.join(dir, "m.ts"), "1");
    session("mirror", dir, { peer_mirror: 1 });
    await collectLocal(origin);
    expect(liveClaims()).toHaveLength(0);
  });
});
