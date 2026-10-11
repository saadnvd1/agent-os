import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkGhCli, getPRForBranch, resetGhCliCheck } from "./pr";

// A stand-in gh on PATH that counts its runs and takes `delayMs` to answer.
function stubGh(delayMs: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-pr-async-"));
  const count = path.join(dir, "count");
  fs.writeFileSync(
    path.join(dir, "gh"),
    `#!/usr/bin/env node
const fs = require("fs");
fs.appendFileSync(${JSON.stringify(count)}, "x");
setTimeout(() => console.log("[]"), ${delayMs});
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
    resetGhCliCheck();
  });

  it("keeps serving while gh is slow", async () => {
    const gh = stubGh(600);
    const [pr, ticks] = await ticksDuring(getPRForBranch(gh.dir, "feature"));
    expect(pr).toBeNull();
    expect(ticks).toBeGreaterThanOrEqual(10);
  });

  it("remembers a gh login, and asks again after a no", async () => {
    const gh = stubGh(0);
    expect(await checkGhCli()).toBe(true);
    expect(await checkGhCli()).toBe(true);
    expect(gh.runs()).toBe(1);

    resetGhCliCheck();
    fs.writeFileSync(path.join(gh.dir, "gh"), "#!/bin/sh\nexit 1\n");
    expect(await checkGhCli()).toBe(false);
    expect(await checkGhCli()).toBe(false);
  });
});
