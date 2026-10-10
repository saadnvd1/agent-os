import { describe, expect, it } from "vitest";
import {
  currentProjectId,
  draftKeyFor,
  newDraft,
  pickableProjects,
  reusableDraft,
  type Draft,
  type DraftProject,
} from "./drafts";

const project = (over: Partial<DraftProject> = {}): DraftProject => ({
  id: "p1",
  agent_type: "codex",
  default_model: "gpt-5.6-terra",
  host_id: "local",
  is_uncategorized: false,
  ...over,
});

describe("newDraft", () => {
  it("takes a real project's agent and model over what you were using", () => {
    const d = newDraft("d1", project(), {
      agentType: "claude",
      model: "haiku",
      access: "full",
    });
    expect(d).toMatchObject({
      projectId: "p1",
      agentType: "codex",
      model: "gpt-5.6-terra",
      access: "full",
      useWorktree: true,
      openPr: false,
    });
  });

  it("keeps the agent, model and access you were using for a scratch chat", () => {
    const d = newDraft("d1", null, {
      agentType: "claude",
      model: "haiku",
      access: "ask",
    });
    expect(d).toMatchObject({
      projectId: null,
      hostId: "local",
      agentType: "claude",
      model: "haiku",
      access: "ask",
      useWorktree: false,
    });
  });

  it("treats the old Uncategorized project as scratch", () => {
    const d = newDraft("d1", project({ is_uncategorized: true }), {});
    expect(d.projectId).toBeNull();
    expect(d.agentType).toBe("claude");
  });

  it("runs where a remote project lives, without a worktree", () => {
    const d = newDraft("d1", project({ host_id: "box" }), {});
    expect(d).toMatchObject({ hostId: "box", useWorktree: false });
  });
});

describe("reusableDraft", () => {
  const draft = (id: string, over: Partial<Draft> = {}): Draft => ({
    ...newDraft(id, project(), {}),
    ...over,
  });
  const typed = new Set(["typed"]);
  const hasText = (id: string) => typed.has(id);

  it("reuses the project's empty draft", () => {
    const drafts = [draft("typed"), draft("empty")];
    expect(reusableDraft(drafts, "p1", hasText)?.id).toBe("empty");
  });

  it("keeps a draft with text in it and makes a new one", () => {
    expect(reusableDraft([draft("typed")], "p1", hasText)).toBeNull();
  });

  it("never hands a task draft to a session, or another project's draft", () => {
    const drafts = [
      draft("task", { openPr: true }),
      draft("other", { projectId: "p2" }),
    ];
    expect(reusableDraft(drafts, "p1", hasText)).toBeNull();
    expect(reusableDraft(drafts, "p1", hasText, true)?.id).toBe("task");
  });

  it("reuses an empty scratch draft for a scratch chat", () => {
    const drafts = [draft("s", { projectId: null })];
    expect(reusableDraft(drafts, null, hasText)?.id).toBe("s");
  });
});

describe("currentProjectId", () => {
  const projects = [
    { id: "uncategorized", is_uncategorized: true },
    { id: "a", is_uncategorized: false },
    { id: "b", is_uncategorized: false },
  ];
  const recent = [
    { project_id: "a", updated_at: "2026-10-01 10:00:00" },
    { project_id: "b", updated_at: "2026-10-05 10:00:00" },
    { project_id: "uncategorized", updated_at: "2026-10-06 10:00:00" },
  ];

  it("is the project you're in", () => {
    expect(currentProjectId({ projectId: "a" }, recent, projects)).toBe("a");
  });

  it("is the most recently used real project otherwise", () => {
    expect(currentProjectId(null, recent, projects)).toBe("b");
    expect(
      currentProjectId({ projectId: "uncategorized" }, recent, projects)
    ).toBe("b");
  });

  it("is none when there are no projects", () => {
    expect(currentProjectId(null, [], [projects[0]])).toBeNull();
  });

  it("skips the filter with no workspace selected", () => {
    expect(
      currentProjectId(null, recent, projects, {
        workspaceId: null,
        projectId: "a",
      })
    ).toBe("b");
  });

  describe("with a workspace selected in the sidebar", () => {
    const projects = [
      { id: "uncategorized", is_uncategorized: true, workspace_id: null },
      { id: "a", is_uncategorized: false, workspace_id: "w1" },
      { id: "b", is_uncategorized: false, workspace_id: "w2" },
      { id: "c", is_uncategorized: false, workspace_id: "w2" },
    ];
    const recent = [
      { project_id: "a", updated_at: "2026-10-09 10:00:00" },
      { project_id: "c", updated_at: "2026-10-05 10:00:00" },
    ];
    const w2 = { workspaceId: "w2", projectId: null };

    it("stays in it while you view a session in another workspace", () => {
      expect(currentProjectId({ projectId: "a" }, recent, projects, w2)).toBe(
        "c"
      );
    });

    it("takes its most recently used project, not another workspace's", () => {
      expect(currentProjectId(null, recent, projects, w2)).toBe("c");
    });

    it("takes the sidebar's project filter over the most recent", () => {
      expect(
        currentProjectId(null, recent, projects, { ...w2, projectId: "b" })
      ).toBe("b");
    });

    it("keeps a viewed project in it over the sidebar's filter", () => {
      expect(
        currentProjectId({ projectId: "c" }, recent, projects, {
          ...w2,
          projectId: "b",
        })
      ).toBe("c");
    });

    it("ignores a filter left over from another workspace", () => {
      expect(
        currentProjectId(null, recent, projects, { ...w2, projectId: "a" })
      ).toBe("c");
    });

    it("falls back to its first project when none was used", () => {
      expect(currentProjectId(null, [], projects, w2)).toBe("b");
    });

    it("is none when it has no projects", () => {
      expect(
        currentProjectId({ projectId: "a" }, recent, projects, {
          workspaceId: "w3",
          projectId: null,
        })
      ).toBeNull();
    });
  });
});

describe("pickableProjects", () => {
  const projects = [
    { id: "uncategorized", is_uncategorized: true, workspace_id: null },
    { id: "a", is_uncategorized: false, workspace_id: "w1" },
    { id: "b", is_uncategorized: false, workspace_id: "w2" },
  ];
  const ids = (ws: string | null) =>
    pickableProjects(projects, ws).map((p) => p.id);

  it("offers only the selected workspace's projects", () => {
    expect(ids("w2")).toEqual(["b"]);
  });

  it("offers every real project with none selected", () => {
    expect(ids(null)).toEqual(["a", "b"]);
  });

  it("offers none for a workspace with no projects", () => {
    expect(ids("w3")).toEqual([]);
  });
});

describe("draftKeyFor", () => {
  const key = (over: Partial<Parameters<typeof draftKeyFor>[0]>) =>
    draftKeyFor({
      code: "KeyN",
      mod: true,
      shiftKey: false,
      altKey: false,
      ...over,
    });

  it("routes ⌘N, ⌘⇧N and ⌘⌥N", () => {
    expect(key({})).toBe("current");
    expect(key({ shiftKey: true })).toBe("choose");
    expect(key({ altKey: true })).toBe("scratch");
  });

  it("routes ⌥N, ⌥⇧N and ⌃⌥N, which browsers pass to the page", () => {
    expect(key({ mod: false, altKey: true })).toBe("current");
    expect(key({ mod: false, altKey: true, shiftKey: true })).toBe("choose");
    expect(key({ mod: false, altKey: true, ctrlKey: true })).toBe("scratch");
    expect(
      key({ mod: false, altKey: true, ctrlKey: true, shiftKey: true })
    ).toBeNull();
  });

  it("ignores N without a modifier, other keys, and ⌘⌥⇧N", () => {
    expect(key({ mod: false })).toBeNull();
    expect(key({ mod: false, shiftKey: true })).toBeNull();
    expect(key({ code: "KeyM" })).toBeNull();
    expect(key({ altKey: true, shiftKey: true })).toBeNull();
  });
});
