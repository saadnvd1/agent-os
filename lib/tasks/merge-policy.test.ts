import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { createProject } from "@/lib/projects";
import {
  mergePolicy,
  projectMergeSettings,
  setGlobalMergeSettings,
  setProjectMergeSettings,
} from "./merge-policy";

function project(agentosJson?: unknown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-merge-policy-"));
  if (agentosJson !== undefined)
    fs.writeFileSync(
      path.join(dir, "agentos.json"),
      JSON.stringify(agentosJson)
    );
  return createProject({
    name: `p-${Math.random().toString(36).slice(2, 8)}`,
    workingDirectory: dir,
  });
}

beforeEach(() => setGlobalMergeSettings({}));

describe("mergePolicy", () => {
  it("defaults to squash with both deletions on", () => {
    expect(mergePolicy(project())).toEqual({
      method: "squash",
      delete_remote_branch: true,
      delete_worktree: true,
      from: {
        method: "default",
        delete_remote_branch: "default",
        delete_worktree: "default",
      },
    });
  });

  it("layers global < agentos.json < the project's own setting, per field", () => {
    setGlobalMergeSettings({ method: "merge", delete_worktree: false });
    const p = project({
      merge: { method: "rebase", delete_remote_branch: false },
    });
    expect(mergePolicy(p)).toMatchObject({
      method: "rebase",
      delete_remote_branch: false,
      delete_worktree: false,
      from: {
        method: "agentos.json",
        delete_remote_branch: "agentos.json",
        delete_worktree: "global",
      },
    });
    setProjectMergeSettings(p.id, { method: "squash" });
    expect(mergePolicy(p)).toMatchObject({
      method: "squash",
      from: { method: "project" },
    });
    // What it would be without its own setting.
    expect(mergePolicy(p, { inherited: true })).toMatchObject({
      method: "rebase",
      from: { method: "agentos.json" },
    });
    expect(mergePolicy(null)).toMatchObject({ method: "merge" });
  });

  it("ignores a broken agentos.json rather than failing the merge", () => {
    const p = project({ merge: { method: "octopus" } });
    expect(mergePolicy(p).method).toBe("squash");
  });

  it("refuses a method that doesn't exist, and clears on empty", () => {
    const p = project();
    expect(() =>
      setProjectMergeSettings(p.id, { method: "fast-forward" })
    ).toThrow();
    expect(() => setProjectMergeSettings(p.id, { delete: true })).toThrow();
    setProjectMergeSettings(p.id, { method: "merge" });
    expect(projectMergeSettings(p.id)).toEqual({ method: "merge" });
    setProjectMergeSettings(p.id, { method: undefined });
    expect(projectMergeSettings(p.id)).toEqual({});
  });
});
