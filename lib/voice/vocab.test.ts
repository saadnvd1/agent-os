import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedSession, seedWorkspace } from "@/lib/orchestrator/testing";
import { createProject } from "@/lib/projects";
import { createWorkspace, setProjectWorkspace } from "@/lib/workspaces";
import { VOICE_LIMITS } from "@/lib/config/client-config-types";
import { vocabFor } from "./vocab";

describe("vocabFor", () => {
  it("has the workspace's names, commands and fixed verbs, deduped", () => {
    const { workspace, app } = seedWorkspace("Acme");
    seedSession({ projectId: app.id, name: "fix-composer", task: true });
    seedSession({ projectId: app.id, name: "Fix Composer", task: true });
    const phrases = vocabFor(workspace.id);
    expect(phrases[0]).toBe("Acme");
    expect(phrases).toContain(app.name.replace(/-/g, " "));
    expect(
      phrases.filter((p) => p.toLowerCase() === "fix composer")
    ).toHaveLength(1);
    expect(phrases).toContain("fresh");
    expect(phrases).toContain("TestFlight");
    expect(phrases).toContain("ship it");
  });

  it("caps the list and every phrase", () => {
    const { workspace, app } = seedWorkspace();
    for (let i = 0; i < 150; i++)
      seedSession({ projectId: app.id, name: `task ${i}`, task: true });
    seedSession({ projectId: app.id, name: "x".repeat(60), task: true });
    const phrases = vocabFor(workspace.id);
    expect(phrases).toHaveLength(VOICE_LIMITS.maxPhrases);
    expect(phrases.every((p) => p.length <= 40)).toBe(true);
  });

  it("never includes anything that looks like a secret", () => {
    const { workspace, app } = seedWorkspace();
    seedSession({
      projectId: app.id,
      name: ["sk", "ant", "api03", "abcdefghijklmnopqrstuvwxyz0123"].join("-"),
      task: true,
    });
    seedSession({
      projectId: app.id,
      name: "0123456789abcdef0123456789abcdef01234567",
      task: true,
    });
    const phrases = vocabFor(workspace.id).join("\n");
    expect(phrases).not.toContain("sk-ant");
    expect(phrases).not.toContain("0123456789abcdef");
  });

  it("is scoped to the workspace and leaves out finished tasks", () => {
    const { workspace } = seedWorkspace();
    const other = createWorkspace("Other");
    const p = createProject({
      name: "secret-project",
      workingDirectory: "/tmp/o",
    });
    setProjectWorkspace(p.id, other.id);
    seedSession({ projectId: p.id, name: "other-session", task: true });
    const mine = seedWorkspace();
    const done = seedSession({
      projectId: mine.app.id,
      name: "old-merged",
      task: true,
    });
    db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
      done
    );
    const phrases = vocabFor(workspace.id);
    expect(phrases).toContain("Other");
    expect(phrases).not.toContain("secret project");
    expect(phrases).not.toContain("other session");
    expect(vocabFor(mine.workspace.id)).not.toContain("old merged");
  });
});
