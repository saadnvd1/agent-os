import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const script = path.join(__dirname, "check-bundle.mjs");

function run(stats: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-"));
  const file = path.join(dir, "stats.json");
  fs.writeFileSync(file, JSON.stringify(stats));
  const r = spawnSync(process.execPath, [script, file], { encoding: "utf-8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: r.stdout + r.stderr };
}

describe("the first-load JS budget", () => {
  it("passes a build under budget", () => {
    const r = run([{ route: "/", firstLoadUncompressedJsBytes: 900_000 }]);
    expect(r.code).toBe(0);
  });

  it("fails a build over budget", () => {
    const r = run([{ route: "/", firstLoadUncompressedJsBytes: 2_000_000 }]);
    expect([r.code, r.out]).toEqual([1, expect.stringContaining("over its")]);
  });

  it("fails closed when the size is missing or not a number", () => {
    for (const entry of [
      { route: "/" },
      { route: "/", firstLoadUncompressedJsBytes: "1" },
    ]) {
      const r = run([entry]);
      expect([r.code, r.out]).toEqual([
        1,
        expect.stringContaining("no firstLoadUncompressedJsBytes"),
      ]);
    }
  });

  it("fails when the route isn't in the stats", () => {
    expect(
      run([{ route: "/pair", firstLoadUncompressedJsBytes: 1 }]).code
    ).toBe(1);
  });
});
