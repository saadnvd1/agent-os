import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RESULTS_CAP, searchCode } from "./code-search";

const hasRg = (() => {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// CI installs ripgrep, so there a missing rg fails rather than skips.
describe.skipIf(!hasRg && !process.env.CI)("searchCode", () => {
  it("reads a query starting with - as a pattern, never an option", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-search-"));
    fs.writeFileSync(path.join(dir, "a.sh"), 'touch "$0.ran"\n--pre=sh\n');
    const matches = await searchCode(dir, "--pre=sh");
    expect(fs.existsSync(path.join(dir, "a.sh.ran"))).toBe(false);
    expect(matches.length).toBeGreaterThan(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// A stand-in rg on PATH: prints `count` matches, then hangs for 30 s.
function stubRg(count: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-search-stub-"));
  const line = (i: number) =>
    JSON.stringify({
      type: "match",
      data: {
        path: { text: `f${i}.ts` },
        lines: { text: "hit\n" },
        line_number: i + 1,
        absolute_offset: 0,
        submatches: [{ match: { text: "hit" }, start: 0, end: 3 }],
      },
    });
  fs.writeFileSync(
    path.join(dir, "rg"),
    `#!/usr/bin/env node
const lines = ${JSON.stringify(Array.from({ length: count }, (_, i) => line(i)))};
process.stdout.write(lines.join("\\n") + "\\n");
setTimeout(() => {}, 30000);
`,
    { mode: 0o755 }
  );
  vi.stubEnv("PATH", `${dir}:${process.env.PATH}`);
  return dir;
}

describe("searchCode off the event loop", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("stops rg at the result cap", async () => {
    const dir = stubRg(50);
    const started = Date.now();
    const matches = await searchCode(dir, "hit", { maxResults: 5 });
    expect(matches).toHaveLength(5);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("caps maxResults however many are asked for", async () => {
    const dir = stubRg(MAX_RESULTS_CAP + 20);
    const matches = await searchCode(dir, "hit", { maxResults: 100_000 });
    expect(matches).toHaveLength(MAX_RESULTS_CAP);
  });

  it("gives what it found at the timeout, and keeps serving meanwhile", async () => {
    const dir = stubRg(2);
    let ticks = 0;
    const timer = setInterval(() => ticks++, 20);
    const matches = await searchCode(dir, "hit", { timeoutMs: 400 });
    clearInterval(timer);
    expect(matches.map((m) => m.data.path.text)).toEqual(["f0.ts", "f1.ts"]);
    expect(ticks).toBeGreaterThanOrEqual(5);
  });

  it("stops when the caller aborts", async () => {
    const dir = stubRg(1);
    const abort = new AbortController();
    const search = searchCode(dir, "hit", { signal: abort.signal });
    setTimeout(() => abort.abort(), 200);
    const started = Date.now();
    expect(await search).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("says when rg isn't installed", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "code-search-none-"));
    vi.stubEnv("PATH", "/nonexistent");
    await expect(searchCode(dir, "x")).rejects.toThrow(
      /ripgrep \(rg\) not found/
    );
  });
});
