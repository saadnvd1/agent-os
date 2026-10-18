import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkGhCli, getPRForBranch } from "./pr";
import { GhBackoffError, noteGhFailure, resetGhLimit } from "./tasks/gh-limit";
import { tempDir } from "@/lib/test-temp";

// A stand-in gh on PATH that counts its runs, takes `delayMs` to answer and
// exits with `code`.
function stubGh(delayMs: number, code = 0) {
  const dir = tempDir("aos-pr-async-");
  const count = path.join(dir, "count");
  fs.writeFileSync(
    path.join(dir, "gh"),
    `#!/usr/bin/env node
const fs = require("fs");
fs.appendFileSync(${JSON.stringify(count)}, "x");
setTimeout(() => { console.log("[]"); process.exit(${code}); }, ${delayMs});
`,
    { mode: 0o755 }
  );
  vi.stubEnv("PATH", `${dir}:${process.env.PATH}`);
  return {
    dir,
    runs: () =>
      (fs.existsSync(count) ? fs.readFileSync(count, "utf8") : "").length,
  };
}

// Counts timer ticks while `work` runs: a blocked event loop gets none.
async function ticksDuring<T>(work: Promise<T>): Promise<[T, number]> {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 20);
  try {
    return [await work, ticks];
  } finally {
    clearInterval(timer);
  }
}

describe("PR reads off the event loop", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetGhLimit();
  });

  it("keeps serving while gh is slow", async () => {
    const gh = stubGh(600);
    const [pr, ticks] = await ticksDuring(getPRForBranch(gh.dir, "feature"));
    expect(pr).toBeNull();
    expect(ticks).toBeGreaterThanOrEqual(10);
  });

  it("asks gh every time, yes or no", async () => {
    const yes = stubGh(0);
    expect(await checkGhCli()).toBe(true);
    expect(await checkGhCli()).toBe(true);
    expect(yes.runs()).toBe(2);
    vi.unstubAllEnvs();

    const no = stubGh(0, 1);
    expect(await checkGhCli()).toBe(false);
    expect(await checkGhCli()).toBe(false);
    expect(no.runs()).toBe(2);
  });

  it("says GitHub's rate limit, not a missing login, while backed off", async () => {
    const gh = stubGh(0);
    await noteGhFailure(["pr", "list"], { stderr: "API rate limit exceeded" });
    await expect(checkGhCli()).rejects.toBeInstanceOf(GhBackoffError);
    // Backed off before gh ran (the rate_limit lookup is the one run).
    expect(gh.runs()).toBeLessThanOrEqual(1);
  });
});
