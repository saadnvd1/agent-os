import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

// Runs the real scripts/redeploy (--pulled, so no git) in a scratch tree with
// stub install, build and pnpm.
let dir: string;
beforeEach(() => {
  dir = tempDir("aos-redeploy-");
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  for (const f of [
    "redeploy",
    "lib/build-swap.sh",
    "lib/pnpm.sh",
    "lib/deps-swap.sh",
  ])
    copyFileSync(join(import.meta.dirname, f), join(dir, "scripts", f));
  chmodSync(join(dir, "scripts/redeploy"), 0o755);
  mkdirSync(join(dir, ".next"));
  writeFileSync(join(dir, ".next/BUILD_ID"), "old");
  mkdirSync(join(dir, "bin"));
  for (const name of ["pnpm"])
    writeFileSync(join(dir, "bin", name), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
  for (const f of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
    writeFileSync(join(dir, f), "{}");
});

const redeploy = (
  restart?: string,
  args: string[] = ["--pulled"],
  extra: Record<string, string> = {}
) => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: dir,
    PATH: `${join(dir, "bin")}:${process.env.PATH}`,
    AGENTOS_INSTALL_CMD: "mkdir -p node_modules",
    AGENTOS_NATIVE_CHECK: "true",
    AGENTOS_BUILD_CMD:
      'mkdir -p "$AGENTOS_DIST_DIR" && echo new > "$AGENTOS_DIST_DIR/BUILD_ID"',
    AGENTOS_UP_WAIT: "1",
    PORT: "1",
  };
  delete env.AGENTOS_RESTART;
  delete env.AGENTOS_UPDATE_TO;
  if (restart) env.AGENTOS_RESTART = restart;
  Object.assign(env, extra);
  return spawnSync("bash", [join(dir, "scripts/redeploy"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env,
  });
};
const liveBuild = () =>
  readFileSync(join(dir, ".next/BUILD_ID"), "utf8").trim();

describe("scripts/redeploy", () => {
  it("without a restart command builds but leaves the live build in place", () => {
    const r = redeploy();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not swapped in");
    expect(liveBuild()).toBe("old");
    expect(existsSync(join(dir, ".next-prev"))).toBe(false);
  });

  it("with a restart command swaps the build in and restarts", () => {
    const r = redeploy(`touch ${join(dir, "restarted")}`);
    expect(liveBuild()).toBe("new");
    expect(r.stdout).toContain("::stage build_swapped");
    // The build it replaced is kept for a rollback, beside the build.
    expect(readFileSync(join(dir, ".next-prev/BUILD_ID"), "utf8")).toBe("old");
    expect(existsSync(join(dir, ".deps/prev/BUILD_ID"))).toBe(false);
    expect(existsSync(join(dir, "restarted"))).toBe(true);
    expect(r.stdout).toContain("::phase restarting");
  });
});

describe("scripts/redeploy with git", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const commit = (cwd: string, msg: string) => {
    git(
      cwd,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      msg
    );
    return git(cwd, "rev-parse", "HEAD");
  };
  // dir becomes a clone at c1 of a remote that has c1..c3.
  const setup = () => {
    const remote = join(dir, "remote.git");
    const src = join(dir, "src");
    git(dir, "init", "-q", "--bare", remote);
    git(dir, "init", "-q", src);
    const shas = ["c1", "c2", "c3"].map((m) => commit(src, m));
    git(src, "push", "-q", remote, "HEAD:refs/heads/main");
    git(dir, "init", "-q");
    git(dir, "remote", "add", "origin", remote);
    git(dir, "fetch", "-q", "origin");
    git(dir, "checkout", "-q", "-b", "main", shas[0]);
    git(dir, "branch", "-q", "--set-upstream-to=origin/main");
    return shas;
  };

  it("AGENTOS_UPDATE_TO fast-forwards to that commit, not the head", () => {
    const [, c2] = setup();
    const r = redeploy(undefined, [], { AGENTOS_UPDATE_TO: c2 });
    expect(r.status).toBe(0);
    expect(git(dir, "rev-parse", "HEAD")).toBe(c2);
    expect(r.stdout).toContain("::stage pulled");
    expect(r.stdout).toContain("::stage deps_swapped");
  });

  it("refuses before pulling when the disk is too full", () => {
    const [c1] = setup();
    const r = redeploy("true", [], { AGENTOS_UPDATE_MIN_FREE_GB: "999999" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Not enough free disk space");
    expect(git(dir, "rev-parse", "HEAD")).toBe(c1);
  });

  it("--rollback --to puts the build, the dependencies and the source back together", () => {
    const [c1, c2] = setup();
    git(dir, "merge", "-q", "--ff-only", c2);
    writeFileSync(join(dir, ".next/BUILD_ID"), "new");
    mkdirSync(join(dir, ".next-prev"));
    writeFileSync(join(dir, ".next-prev/BUILD_ID"), "old");
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "node_modules/which"), "new");
    mkdirSync(join(dir, ".deps/prev"), { recursive: true });
    writeFileSync(join(dir, ".deps/prev/which"), "old");
    const r = redeploy(undefined, ["--rollback", "--to", c1]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::stage build_swapped");
    expect(liveBuild()).toBe("old");
    expect(readFileSync(join(dir, "node_modules/which"), "utf8")).toBe("old");
    expect(git(dir, "rev-parse", "HEAD")).toBe(c1);
  });

  it("--rollback without --to leaves the source where it is", () => {
    const [, c2] = setup();
    git(dir, "merge", "-q", "--ff-only", c2);
    mkdirSync(join(dir, ".next-prev"));
    writeFileSync(join(dir, ".next-prev/BUILD_ID"), "older");
    const r = redeploy(undefined, ["--rollback"]);
    expect(r.status).toBe(0);
    expect(liveBuild()).toBe("older");
    expect(git(dir, "rev-parse", "HEAD")).toBe(c2);
  });
});
