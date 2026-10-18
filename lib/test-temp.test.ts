import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { removeTempDirs, tempDir } from "./test-temp";
import { isTestTempName } from "./worktree-sweep/testTemp";

describe("tempDir", () => {
  it("makes a folder and removes it with the rest", () => {
    const dir = tempDir("aos-temp-helper-");
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    removeTempDirs();
    expect(fs.existsSync(dir)).toBe(false);
  });
});

// A test that calls mkdtemp itself has nothing removing its folder: how
// thousands of them piled up in the OS temp folder.
describe("no direct mkdtemp in tests", () => {
  // Needs its folder inside the working directory, and removes it itself.
  const ALLOWED = new Set(["lib/chat/drivers/pi-approvals.test.ts"]);
  const isTestFile = (f: string) =>
    /(\.test\.tsx?|\.test-helpers\.ts|(^|\/)testing\.ts|(^|\/)test-[\w-]+\.ts)$/.test(
      f
    );

  function files(p: string): string[] {
    if (!fs.existsSync(p) || fs.lstatSync(p).isSymbolicLink()) return [];
    if (fs.lstatSync(p).isFile()) return [p];
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((e) => !["node_modules", ".next", ".git"].includes(e.name))
      .flatMap((e) => files(path.join(p, e.name)));
  }

  it("uses tempDir() from lib/test-temp instead", () => {
    const offenders = files(process.cwd())
      .map((f) => path.relative(process.cwd(), f))
      .filter((f) => isTestFile(f) && f !== "lib/test-temp.ts")
      .filter((f) => f !== "lib/test-temp.test.ts" && !ALLOWED.has(f))
      .filter((f) => /\bmkdtemp(Sync)?\b/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

// The sweep takes only the prefixes it lists: a test with a new aos-… prefix
// must be added there, or its leftovers are never swept.
describe("test temp prefixes the sweep knows", () => {
  it("covers every aos-/agent-os- prefix a test gives tempDir()", () => {
    const missing = new Set<string>();
    const walk = (p: string) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git"].includes(e.name)) continue;
        const f = path.join(p, e.name);
        if (e.isDirectory()) walk(f);
        else if (
          e.isFile() &&
          /\.test\.tsx?$|test-helpers\.ts$|testing\.ts$/.test(e.name)
        )
          for (const m of fs
            .readFileSync(f, "utf8")
            .matchAll(/tempDir\(\s*"((?:aos|agent-os)-[^"$]+)"/g))
            if (!isTestTempName(m[1])) missing.add(m[1]);
      }
    };
    for (const d of ["lib", "app", "components", "scripts", "data"]) walk(d);
    expect([...missing]).toEqual([]);
  });

  it("leaves AgentOS's own temp folders alone", () => {
    for (const name of [
      "aos-review-x",
      "aos-rebase-x",
      "agent-os-screenshots",
      "other",
    ])
      expect(isTestTempName(name)).toBe(false);
  });
});
