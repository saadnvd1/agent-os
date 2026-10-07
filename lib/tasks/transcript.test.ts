import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeProjectDir,
  latestSessionId,
  readTranscript,
  rewritePaths,
  writeTranscript,
} from "./transcript";

const A = "11111111-2222-3333-4444-555555555555";
const B = "99999999-2222-3333-4444-555555555555";

describe("claudeProjectDir", () => {
  it("dashes every character that isn't a letter or digit, as Claude does", () => {
    expect(
      claudeProjectDir("/Users/alice/.agent-os/worktrees/app-x_1", "/c")
    ).toBe("/c/projects/-Users-saad--agent-os-worktrees-app-x-1");
  });
});

describe("rewritePaths", () => {
  const from = {
    cwd: "/Users/alice/.agent-os/worktrees/app-fix",
    home: "/Users/alice",
  };
  const to = {
    cwd: "/home/alice/.agent-os/worktrees/app-fix-2",
    home: "/home/alice",
  };

  it("moves the worktree first, then home, inside JSON strings", () => {
    const line = JSON.stringify({
      cwd: from.cwd,
      text: `edit ${from.cwd}/lib/a.ts and ~/x at /Users/alice/dev/app`,
    });
    const out = JSON.parse(rewritePaths(line, from, to));
    expect(out.cwd).toBe(to.cwd);
    expect(out.text).toBe(
      `edit ${to.cwd}/lib/a.ts and ~/x at /home/alice/dev/app`
    );
  });

  it("leaves a longer name that only starts the same alone", () => {
    const line = JSON.stringify({ p: "/Users/saadx/file /Users/alice" });
    expect(JSON.parse(rewritePaths(line, from, to)).p).toBe(
      "/Users/saadx/file /home/alice"
    );
  });

  it("changes nothing between identical machines", () => {
    const line = JSON.stringify({ cwd: from.cwd });
    expect(rewritePaths(line, from, from)).toBe(line);
  });
});

describe("conversation files", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-cfg-"));
    process.env.CLAUDE_CONFIG_DIR = dir;
  });
  afterEach(() => {
    delete process.env.CLAUDE_CONFIG_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes, reads, and finds the newest conversation in a folder", async () => {
    await writeTranscript("/w/app", A, "a\n");
    await writeTranscript("/w/app", B, "b\n");
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(
      path.join(claudeProjectDir("/w/app"), `${A}.jsonl`),
      old,
      old
    );
    fs.writeFileSync(
      path.join(claudeProjectDir("/w/app"), "agent-x.jsonl"),
      ""
    );
    expect(await readTranscript("/w/app", A)).toBe("a\n");
    expect(await readTranscript("/w/app", B.replace("9", "8"))).toBeNull();
    expect(await latestSessionId("/w/app")).toBe(B);
    expect(await latestSessionId("/w/none")).toBeNull();
  });

  it("refuses an id that isn't a session id (no path tricks)", async () => {
    await expect(writeTranscript("/w/app", "../../x", "")).rejects.toThrow();
  });
});
