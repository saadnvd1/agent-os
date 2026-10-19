import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

const LIB = join(import.meta.dirname, "deps-swap.sh");

let dir: string;
const read = (p: string) => readFileSync(join(dir, p), "utf8");

// Runs the library's functions in `dir` with a fake install and native check.
function run(script: string, env: Record<string, string> = {}) {
  return spawnSync("bash", ["-c", `source "${LIB}"; ${script}`], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

const INSTALL = "mkdir -p node_modules && echo new > node_modules/marker";

beforeEach(() => {
  dir = tempDir("deps-swap-");
  for (const f of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
    writeFileSync(join(dir, f), `{}\n`);
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "node_modules/marker"), "old\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("install_beside", () => {
  it("installs beside, checks, and swaps in; the old tree is kept for a rollback", () => {
    const r = run("install_beside && swap_deps", {
      AGENTOS_INSTALL_CMD: INSTALL,
      AGENTOS_NATIVE_CHECK: "true",
    });
    expect(r.status).toBe(0);
    expect(read("node_modules/marker")).toBe("new\n");
    expect(read(".deps/prev/marker")).toBe("old\n");
    expect(existsSync(join(dir, ".deps/stage"))).toBe(false);
  });

  it("leaves the live node_modules alone when the native check fails", () => {
    const r = run("install_beside", {
      AGENTOS_INSTALL_CMD: INSTALL,
      AGENTOS_NATIVE_CHECK: "exit 1",
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Native modules do not load");
    expect(read("node_modules/marker")).toBe("old\n");
    expect(existsSync(join(dir, ".deps/stage"))).toBe(false);
  });

  it("leaves the live node_modules alone when the install fails", () => {
    const r = run("install_beside", {
      AGENTOS_INSTALL_CMD: "exit 3",
      AGENTOS_NATIVE_CHECK: "true",
    });
    expect(r.status).toBe(1);
    expect(read("node_modules/marker")).toBe("old\n");
  });

  it("skips the install when nothing it depends on changed", () => {
    const first = run("install_beside && swap_deps", {
      AGENTOS_INSTALL_CMD: INSTALL,
      AGENTOS_NATIVE_CHECK: "true",
    });
    expect(first.status).toBe(0);
    const again = run("install_beside", {
      AGENTOS_INSTALL_CMD: "exit 9",
      AGENTOS_NATIVE_CHECK: "exit 9",
    });
    expect(again.status).toBe(10);
    // A rollback has nothing to restore: the last build used these same deps.
    expect(existsSync(join(dir, ".deps/prev"))).toBe(false);
  });

  it("installs again when the lockfile changes", () => {
    run("install_beside && swap_deps", {
      AGENTOS_INSTALL_CMD: INSTALL,
      AGENTOS_NATIVE_CHECK: "true",
    });
    writeFileSync(join(dir, "pnpm-lock.yaml"), "changed\n");
    const r = run("install_beside", {
      AGENTOS_INSTALL_CMD: INSTALL,
      AGENTOS_NATIVE_CHECK: "true",
    });
    expect(r.status).toBe(0);
  });
});

describe("restore_deps", () => {
  it("puts the previous node_modules back after a swap", () => {
    run("install_beside && swap_deps && restore_deps", {
      AGENTOS_INSTALL_CMD: INSTALL,
      AGENTOS_NATIVE_CHECK: "true",
    });
    expect(read("node_modules/marker")).toBe("old\n");
    expect(existsSync(join(dir, ".deps/prev"))).toBe(false);
  });

  it("does nothing without a previous tree", () => {
    rmSync(join(dir, ".deps"), { recursive: true, force: true });
    const r = run("restore_deps");
    expect(r.status).toBe(0);
    expect(read("node_modules/marker")).toBe("old\n");
  });
});
