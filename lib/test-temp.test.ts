import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { removeTempDirs, tempDir } from "./test-temp";

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
    if (!fs.existsSync(p)) return [];
    if (fs.statSync(p).isFile()) return [p];
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
