/**
 * Times a new worktree's setup and its first typecheck, test and build, and
 * the disk it takes, against a checkout. Run it with the seeding on, then
 * with AGENTOS_NO_BUILD_CACHES=1 (and, to see an install on Linux, --install).
 *
 *   npx tsx scripts/bench/worktree-setup.ts <checkout> [--test <file>]
 *     [--build] [--install] [--cwd <subdir>] [--drop <seeded path>]
 *
 * It makes a throwaway git worktree of the checkout's HEAD in the temp
 * directory and removes it at the end; it touches nothing else.
 */

import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { setupWorktree } from "../../lib/env-setup";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => args[args.indexOf(name) + 1];
const source = path.resolve(args[0]);
const sub = flag("--cwd") ? value("--cwd") : ".";

const freeKb = (dir: string) =>
  Number(
    execFileSync("df", ["-Pk", dir], { encoding: "utf-8" })
      .trim()
      .split("\n")[1]
      .split(/\s+/)[3]
  );

function timed(command: string, cwd: string) {
  const start = Date.now();
  const run = spawnSync(command, { cwd, shell: true, stdio: "ignore" });
  return { seconds: (Date.now() - start) / 1000, ok: run.status === 0 };
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aos-bench-"));
  const worktree = path.join(root, "wt");
  execFileSync("git", ["worktree", "add", "-q", "--detach", worktree, "HEAD"], {
    cwd: source,
  });
  const out: Record<string, unknown> = {
    source: path.basename(source),
    platform: process.platform,
    seeding: process.env.AGENTOS_NO_BUILD_CACHES ? "off" : "on",
  };
  try {
    const before = freeKb(root);
    const start = Date.now();
    let steps: string[] = [];
    if (flag("--install")) {
      const r = timed("npm ci --include=dev", worktree);
      steps = [`npm ci ok=${r.ok}`];
    } else {
      const result = await setupWorktree({
        worktreePath: worktree,
        sourcePath: source,
      });
      steps = result.steps.map(
        (s) => `${s.name}: ${s.success ? "ok" : "failed"}`
      );
    }
    out.setupSeconds = (Date.now() - start) / 1000;
    out.setupSteps = steps;
    out.diskMbAfterSetup = Math.round((before - freeKb(root)) / 1024);
    // Take a seeded cache back out to measure without it.
    if (flag("--drop"))
      fs.rmSync(path.join(worktree, value("--drop")), {
        recursive: true,
        force: true,
      });
    const dir = path.join(worktree, sub);
    const pkg = path.join(dir, "package.json");
    const typecheck = fs.existsSync(pkg)
      ? JSON.parse(fs.readFileSync(pkg, "utf-8")).scripts?.typecheck
      : undefined;
    if (typecheck) out.typecheck = timed("npm run typecheck", dir);
    else if (fs.existsSync(path.join(dir, "tsconfig.json")))
      out.typecheck = timed("npx tsc --noEmit", dir);
    if (flag("--test"))
      out.test = timed(`npx vitest run ${value("--test")}`, dir);
    if (flag("--build")) {
      out.build = timed("npx next build", dir);
      out.diskMbAfterBuild = Math.round((before - freeKb(root)) / 1024);
    }
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", worktree], {
      cwd: source,
    });
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(JSON.stringify(out));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
