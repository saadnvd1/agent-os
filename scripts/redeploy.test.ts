import { spawnSync } from "node:child_process";
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

const redeploy = (restart?: string) => {
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
  if (restart) env.AGENTOS_RESTART = restart;
  return spawnSync("bash", [join(dir, "scripts/redeploy"), "--pulled"], {
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
    expect(existsSync(join(dir, "restarted"))).toBe(true);
    expect(r.stdout).toContain("::phase restarting");
  });
});
