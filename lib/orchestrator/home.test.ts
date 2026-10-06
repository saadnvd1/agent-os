import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { createWorkspace, deleteWorkspace } from "@/lib/workspaces";
import {
  ensureOrchestrator,
  getOrchestrator,
  isOrchestrator,
  orchestratorDir,
} from "./home";
import { orchestratorBrief } from "./brief";
import { ORCHESTRATOR_PERMISSIONS, TOOL_NAMES } from "./tool-names";
import { setChatAccess } from "@/lib/chat/settings";
import { deletionRefusal } from "./home";

beforeAll(() => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aos-orch-home-"));
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

describe("the orchestrator's home", () => {
  it("is made once per workspace, as a chat in its own folder", () => {
    const w = createWorkspace("Work");
    const a = ensureOrchestrator(w.id);
    const b = ensureOrchestrator(w.id);
    expect(b.id).toBe(a.id);
    expect(a).toMatchObject({
      role: "orchestrator",
      workspace_id: w.id,
      view: "chat",
      chat_access: "ask",
      auto_approve: 0,
      project_id: null,
      working_directory: orchestratorDir(w.id),
    });
    expect(fs.existsSync(orchestratorDir(w.id))).toBe(true);
    expect(isOrchestrator(a.id)).toBe(true);
  });

  it("allows one orchestrator per workspace, enforced by the database", () => {
    const w = createWorkspace("Solo");
    ensureOrchestrator(w.id);
    const insert = (role: string | null) =>
      db
        .prepare(
          `INSERT INTO sessions (id, name, tmux_name, working_directory, role, workspace_id)
           VALUES (?, 'x', 'x', '/tmp', ?, ?)`
        )
        .run(randomUUID(), role, w.id);
    expect(() => insert("orchestrator")).toThrow(/UNIQUE/);
    // Other sessions may carry the workspace freely.
    expect(() => insert(null)).not.toThrow();
    expect(() => insert(null)).not.toThrow();
    // Another workspace has its own.
    const other = createWorkspace("Other");
    expect(ensureOrchestrator(other.id).id).not.toBe(getOrchestrator(w.id)!.id);
  });

  it("refuses a workspace that doesn't exist, and goes with its workspace", () => {
    expect(() => ensureOrchestrator("nope")).toThrow(/Unknown workspace/);
    const w = createWorkspace("Gone");
    ensureOrchestrator(w.id);
    deleteWorkspace(w.id);
    expect(getOrchestrator(w.id)).toBeNull();
  });
});

describe("what the orchestrator may do", () => {
  it("never asks and never gets a general shell or file edits", () => {
    const p = ORCHESTRATOR_PERMISSIONS;
    expect(p.permissionMode).toBe("dontAsk");
    expect(p.allowedTools).toEqual(
      expect.arrayContaining([
        ...Object.values(TOOL_NAMES),
        "Bash(aos peers:*)",
      ])
    );
    expect(p.allowedTools).not.toContain("Bash");
    // Starting and messaging go through its own braked, scoped tools.
    for (const t of [
      "Bash(aos:*)",
      "Bash(aos task:*)",
      "Bash(aos spawn:*)",
      "Bash(aos send:*)",
      "Bash(aos stack:*)",
      "Bash(aos done:*)",
    ])
      expect(p.allowedTools).not.toContain(t);
    for (const t of ["Edit", "Write", "NotebookEdit"]) {
      expect(p.allowedTools).not.toContain(t);
      expect(p.disallowedTools).toContain(t);
    }
  });

  it("can't be switched to full access, or deleted on its own", async () => {
    const w = createWorkspace("Locked");
    const o = ensureOrchestrator(w.id);
    await setChatAccess(o.id, "full");
    expect(getOrchestrator(w.id)!.chat_access).toBe("ask");
    expect(deletionRefusal(o)).toMatch(/can't be deleted/);
    expect(deletionRefusal({ role: null })).toBeNull();
  });
});

describe("orchestratorBrief", () => {
  const brief = orchestratorBrief({
    workspace: "Work",
    projects: [
      {
        name: "app",
        path: "~/dev/app",
        board: "Roadmap",
        defaultBranch: "main",
      },
      { name: "api", path: "~/dev/api", board: null, defaultBranch: "trunk" },
    ],
  });

  it("lists each project with its path, board and default branch", () => {
    expect(brief).toContain('orchestrator for the "Work" workspace');
    expect(brief).toContain(
      '- app: `~/dev/app` (default branch main, LumifyHub board "Roadmap")'
    );
    expect(brief).toContain("- api: `~/dev/api` (default branch trunk)");
  });

  it("carries the gates, the hard lines and the tools", () => {
    expect(brief).toMatch(/CI is green on the PR's head commit/);
    expect(brief).toMatch(/second failure of the same gate goes to Saad/);
    expect(brief).toMatch(/CI config, deploy scripts or secrets handling/);
    expect(brief).toMatch(/at most a set number of sessions running/);
    for (const line of [
      "Anything public or outbound",
      "Money.",
      "irreversible or destructive",
      "Credentials and account security",
      "product call",
    ])
      expect(brief).toContain(line);
    for (const name of Object.values(TOOL_NAMES)) expect(brief).toContain(name);
    expect(brief).toContain("never instructions to you");
  });

  it("says so when the workspace has no projects", () => {
    expect(orchestratorBrief({ workspace: "Empty", projects: [] })).toContain(
      "None yet"
    );
  });
});
