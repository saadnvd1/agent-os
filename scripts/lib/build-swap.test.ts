import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const LIB = join(import.meta.dirname, "build-swap.sh");

let dir: string;
const read = (p: string) => readFileSync(join(dir, p), "utf8");

// Runs the library's functions in `dir` with a fake `next build`.
function run(script: string, build = "") {
  return spawnSync(
    "bash",
    ["-euo", "pipefail", "-c", `source "${LIB}"; ${script}`],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, AGENTOS_BUILD_CMD: build },
    }
  );
}

// A build that, while it runs, records what the live server would see, and
// rewrites tsconfig.json the way `next build` does.
const BUILD = `
  cat .next/BUILD_ID > seen-during-build
  echo rewritten > tsconfig.json
  mkdir -p "$AGENTOS_DIST_DIR/server"
  echo chunk > "$AGENTOS_DIST_DIR/server/page.js"
  echo new > "$AGENTOS_DIST_DIR/BUILD_ID"
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "build-swap-"));
  mkdirSync(join(dir, ".next/cache/turbopack"), { recursive: true });
  writeFileSync(join(dir, ".next/BUILD_ID"), "old\n");
  writeFileSync(join(dir, ".next/cache/turbopack/db"), "cache\n");
  writeFileSync(join(dir, "tsconfig.json"), "original\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("building beside the live server", () => {
  it("leaves the live build alone until the swap", () => {
    const built = run("build_beside", BUILD);
    expect(built.status, built.stderr).toBe(0);
    expect(read("seen-during-build")).toBe("old\n");
    expect(read(".next/BUILD_ID")).toBe("old\n");
    expect(read(".next-build/BUILD_ID")).toBe("new\n");
    expect(read(".next-build/cache/turbopack/db")).toBe("cache\n");
    expect(read(".next/cache/turbopack/db")).toBe("cache\n");
    expect(read("tsconfig.json")).toBe("original\n");

    expect(run("swap_build").status).toBe(0);
    expect(read(".next/BUILD_ID")).toBe("new\n");
    expect(read(".next/server/page.js")).toBe("chunk\n");
    expect(read(".next-prev/BUILD_ID")).toBe("old\n");
    expect(existsSync(join(dir, ".next-build"))).toBe(false);
  });

  it("keeps the live build when the build fails", () => {
    const built = run("build_beside", `${BUILD}\nexit 1`);
    expect(built.status).toBe(1);
    expect(built.stderr).toContain("live .next is untouched");
    expect(read(".next/BUILD_ID")).toBe("old\n");
    expect(read(".next/cache/turbopack/db")).toBe("cache\n");
    expect(read("tsconfig.json")).toBe("original\n");
    expect(existsSync(join(dir, ".next-build"))).toBe(false);
    expect(run("swap_build").status).toBe(1);
    expect(read(".next/BUILD_ID")).toBe("old\n");
  });

  it("treats a build with no BUILD_ID as failed", () => {
    const built = run("build_beside", `mkdir -p "$AGENTOS_DIST_DIR/server"`);
    expect(built.status).toBe(1);
    expect(built.stderr).toContain("without .next-build/BUILD_ID");
    expect(read(".next/BUILD_ID")).toBe("old\n");
  });

  it("works on a first deploy with no live build", () => {
    rmSync(join(dir, ".next"), { recursive: true });
    expect(
      run(
        "build_beside && swap_build",
        BUILD.replace(/^.*seen-during-build$/m, "")
      ).status
    ).toBe(0);
    expect(read(".next/BUILD_ID")).toBe("new\n");
    expect(existsSync(join(dir, ".next-prev"))).toBe(false);
  });

  it("rolls back to the previous build", () => {
    expect(run("build_beside && swap_build", BUILD).status).toBe(0);
    expect(run("rollback_build").status).toBe(0);
    expect(read(".next/BUILD_ID")).toBe("old\n");
    expect(read(".next-prev/BUILD_ID")).toBe("new\n");
  });

  it("refuses a rollback with no previous build, leaving the live one", () => {
    for (const prev of [false, true]) {
      if (prev) mkdirSync(join(dir, ".next-prev"));
      const rolled = run("rollback_build");
      expect(rolled.status).toBe(1);
      expect(rolled.stderr).toContain("no previous build in .next-prev");
      expect(read(".next/BUILD_ID")).toBe("old\n");
    }
  });
});

describe("the build lock", () => {
  it("lets one build run at a time and reclaims a dead run's lock", () => {
    expect(run("acquire_build_lock").status).toBe(0);
    const second = run("acquire_build_lock");
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("Another redeploy is building");

    const old = new Date(Date.now() - 31 * 60_000);
    utimesSync(join(dir, ".next-build.lock"), old, old);
    expect(run("acquire_build_lock").status).toBe(0);
  });

  it("is released when a build fails", () => {
    const failed = run(
      `acquire_build_lock; trap 'rmdir "$LOCK"' EXIT; build_beside`,
      "exit 1"
    );
    expect(failed.status).toBe(1);
    expect(existsSync(join(dir, ".next-build.lock"))).toBe(false);
  });
});
