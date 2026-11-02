import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "../../test-temp";
import type { Session } from "../../db";

let root = "";
vi.mock("../../projects", () => ({
  getProject: (id: string) =>
    id === "p" ? { working_directory: root } : undefined,
}));
const { resolveChatCwd, worktreeRemoved, carryClaudeTranscript } =
  await import("./cwd");

const base = (over: Partial<Session>) =>
  ({
    working_directory: "/nope/gone",
    project_id: "p",
    claude_session_id: "abc",
    ...over,
  }) as Session;

let tmp = "";
beforeEach(() => {
  tmp = tempDir("cwd-");
  root = path.join(tmp, "repo");
  fs.mkdirSync(root);
});

describe("resolveChatCwd", () => {
  it("keeps an existing directory", () => {
    const s = base({ working_directory: root });
    expect(resolveChatCwd(s)).toEqual({ session: s, removedFrom: null });
  });
  it("falls back to the project root when the directory is gone", () => {
    const r = resolveChatCwd(base({}));
    expect(r.session.working_directory).toBe(root);
    expect(r.removedFrom).toBe("/nope/gone");
  });
  it("changes nothing when the project has no checkout either", () => {
    const s = base({ project_id: "other" });
    expect(resolveChatCwd(s).removedFrom).toBeNull();
  });
});

describe("worktreeRemoved", () => {
  it("is true only for a finished task whose worktree is missing", () => {
    const t = base({ worktree_path: "/nope/gone", task_status: "merged" });
    expect(worktreeRemoved(t)).toBe(true);
    expect(worktreeRemoved({ ...t, task_status: "running" })).toBe(false);
    expect(worktreeRemoved({ ...t, worktree_path: root })).toBe(false);
  });
});

describe("carryClaudeTranscript", () => {
  it("copies the transcript under the new folder's name", () => {
    process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "cfg");
    const from = path.join(tmp, "wt");
    const src = path.join(
      tmp,
      "cfg/projects",
      from.replace(/[^a-zA-Z0-9]/g, "-")
    );
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "abc.jsonl"), "{}");
    carryClaudeTranscript(from, root, "abc");
    const dest = path.join(
      tmp,
      "cfg/projects",
      root.replace(/[^a-zA-Z0-9]/g, "-"),
      "abc.jsonl"
    );
    expect(fs.readFileSync(dest, "utf8")).toBe("{}");
    delete process.env.CLAUDE_CONFIG_DIR;
  });
});
