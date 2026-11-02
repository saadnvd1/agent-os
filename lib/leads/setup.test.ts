import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  sendChat: async () => {},
  stopChat: () => {},
  chatStateNow: async () => "idle",
}));
vi.mock("@/lib/chat/worker/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/worker/client")>()),
  waitForExit: async () => {},
  removeStaleSocket: () => {},
}));

const { db } = await import("@/lib/db");
const { seedSession, seedWorkspace } =
  await import("@/lib/orchestrator/testing");
const { setExperiment } = await import("@/lib/experiments");
const { leadSetup, suggestKind } = await import("./setup");
const { addLeads } = await import("./home");
const { adoptLead } = await import("./adopt");
const { adoptRefusal } = await import("./adoptable");
const { addLabel, addPlan, NEW_CHAT } = await import("./add-plan");
const { kindFromName } = await import("./order");

afterEach(() => setExperiment("leads", false));

const chat = (projectId: string, name: string) =>
  seedSession({ projectId, name, view: "chat" });

describe("the Add leads sheet's view", () => {
  it("offers the shipped kinds and the workspace's adoptable chats", () => {
    const { workspace, app, task } = seedWorkspace();
    const marketing = chat(app.id, "Acme Marketing lead");
    const terminal = seedSession({ projectId: app.id, name: "shell" });
    const setup = leadSetup(workspace.id)!;
    expect(setup.enabled).toBe(false);
    expect(setup.hasLeads).toBe(false);
    expect(setup.choices.map((c) => [c.kind, c.sessionId])).toEqual([
      ["tech", null],
      ["marketing", null],
      ["product", null],
    ]);
    const ids = setup.candidates.map((c) => c.sessionId);
    expect(ids).toContain(marketing);
    expect(ids).not.toContain(task);
    expect(ids).not.toContain(terminal);
    expect(
      setup.candidates.find((c) => c.sessionId === marketing)!.suggest
    ).toBe("marketing");
  });

  it("marks what was added, lists custom leads and stops offering heads", () => {
    const { workspace, app } = seedWorkspace();
    setExperiment("leads", true);
    addLeads(workspace.id, ["marketing", "design"]);
    const setup = leadSetup(workspace.id)!;
    expect(setup.enabled).toBe(true);
    expect(setup.hasLeads).toBe(true);
    expect(setup.hasOrchestrator).toBe(true);
    const added = Object.fromEntries(
      setup.choices.map((c) => [c.kind, !!c.sessionId])
    );
    expect(added).toEqual({ tech: true, marketing: true, product: false });
    expect(setup.custom.map((c) => [c.kind, c.title])).toEqual([
      ["design", "Design lead"],
    ]);
    // A marketing chat no longer suggests a kind the team has.
    const other = chat(app.id, "marketing notes");
    const offered = leadSetup(workspace.id)!.candidates;
    expect(offered.find((c) => c.sessionId === other)!.suggest).toBeNull();
    const heads = db
      .prepare(
        `SELECT id FROM sessions WHERE workspace_id = ? AND role IS NOT NULL`
      )
      .all(workspace.id) as { id: string }[];
    for (const h of heads)
      expect(offered.map((c) => c.sessionId)).not.toContain(h.id);
  });

  it("drops an adopted chat from the candidates and shows it as added", async () => {
    const { workspace, app } = seedWorkspace();
    const product = chat(app.id, "Product thinking");
    await adoptLead({
      sessionId: product,
      workspaceId: workspace.id,
      kind: "product",
    });
    const setup = leadSetup(workspace.id)!;
    expect(setup.choices.find((c) => c.kind === "product")!.sessionId).toBe(
      product
    );
    expect(setup.candidates.map((c) => c.sessionId)).not.toContain(product);
  });

  it("is null for an unknown workspace", () => {
    expect(leadSetup("nope")).toBeNull();
  });
});

describe("the sheet's helpers", () => {
  it("suggests a kind only for a whole word in the name", () => {
    expect(suggestKind("AgentOS Marketing lead", ["marketing"])).toBe(
      "marketing"
    );
    expect(suggestKind("productivity tips", ["product"])).toBeNull();
    expect(suggestKind("Marketing", [])).toBeNull();
  });

  it("makes a custom kind from a typed name", () => {
    expect(kindFromName("Design lead")).toBe("design");
    expect(kindFromName("  Customer Success ")).toBe("customer-success");
    expect(kindFromName("42 Ops!")).toBe("ops");
    expect(kindFromName("chief")).toBeNull();
    expect(kindFromName("!!!")).toBeNull();
  });

  it("splits picks into new leads and adoptions, counting Tech the first time", () => {
    const picks = [
      { kind: "marketing", source: NEW_CHAT },
      { kind: "product", source: "s1" },
      { kind: "marketing", source: "s2" },
    ];
    const first = addPlan(false, picks);
    expect(first).toEqual({
      kinds: ["marketing"],
      adopt: [{ sessionId: "s1", kind: "product" }],
      count: 3,
    });
    expect(addLabel(first, false)).toBe("Add 3 leads");
    expect(addLabel(addPlan(false, []), false)).toBe("Add the Tech lead");
    expect(addLabel(addPlan(true, []), true)).toBe("Tick a lead to add");
    expect(addLabel(addPlan(true, picks.slice(0, 1)), true)).toBe("Add 1 lead");
  });

  it("refuses to adopt what the server would refuse", () => {
    const ok = {
      role: null,
      view: "chat",
      agent_type: "claude",
      task_status: null,
      worktree_path: null,
      archived_at: null,
      host_id: "local",
    } as const;
    expect(adoptRefusal(ok)).toBeNull();
    expect(adoptRefusal({ ...ok, role: "lead" })).toMatch(/already heads/);
    expect(adoptRefusal({ ...ok, view: "terminal" })).toMatch(/Claude chat/);
    expect(adoptRefusal({ ...ok, agent_type: "codex" })).toMatch(/Claude chat/);
    expect(adoptRefusal({ ...ok, task_status: "running" })).toMatch(/task/);
    expect(adoptRefusal({ ...ok, archived_at: "x" })).toMatch(/Unarchive/);
    expect(adoptRefusal({ ...ok, host_id: "box" })).toMatch(/this machine/);
  });
});
