import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { id: string; text: string }[] = [];
const stopped: string[] = [];
const fresh: string[] = [];
let state: string | null = null;
vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  sendChat: async (id: string, m: { text: string }) => {
    sent.push({ id, text: m.text });
  },
  stopChat: (id: string) => stopped.push(id),
  chatStateNow: async () => state,
  freshStartChat: async (id: string) => {
    fresh.push(id);
    return "now";
  },
}));
vi.mock("@/lib/chat/worker/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/worker/client")>()),
  waitForExit: async () => {},
  removeStaleSocket: () => {},
}));

const { db, updateSessionRow } = await import("@/lib/db");
const { saveItem } = await import("@/lib/chat/store");
const { seedSession, seedWorkspace } =
  await import("@/lib/orchestrator/testing");
const { getOrchestrator } = await import("@/lib/orchestrator/home");
const { addNote } = await import("@/lib/orchestrator/notes");
const { answerAsk, raiseAsk } = await import("@/lib/orchestrator/asks");
const { orchestratorBrief } = await import("@/lib/orchestrator/brief");
const home = await import("./home");
const { profileFor } = await import("./profiles");
const { NotYours, UnknownTool, runStandingTool } = await import("./tools");
const { areaRefusal } = await import("./area");
const { leadBrief, techLeadAdditions } = await import("./brief");
const { buildLeadDigest } = await import("./digest");
const { adoptLead, confirmPins } = await import("./adopt");
const { asActor } = await import("./actor");
const { setLeadAreas } = await import("./charters");
const { hasLeads } = await import("./settings");
const { latestMemo, writeMemo } = await import("./memos");
const { currentDirection, openProposals } = await import("./direction");

beforeEach(() => {
  sent.length = 0;
  stopped.length = 0;
  fresh.length = 0;
  state = null;
});

function withLeads(kinds = ["marketing"]) {
  const seeded = seedWorkspace();
  home.addLeads(seeded.workspace.id, kinds);
  const w = seeded.workspace.id;
  return { ...seeded, w, marketing: home.getLead(w, "marketing")! };
}

describe("adding leads", () => {
  it("claims the orchestrator as Tech and makes each lead once", () => {
    const { w } = withLeads(["marketing", "product"]);
    home.addLeads(w, ["marketing"]);
    const leads = home.listLeads(w);
    expect(leads.map((s) => s.lead_kind)).toEqual([
      "tech",
      "marketing",
      "product",
    ]);
    expect(leads[0].id).toBe(getOrchestrator(w)!.id);
    expect(leads[1]).toMatchObject({ role: "lead", pinned: 1, view: "chat" });
    expect(hasLeads(w)).toBe(true);
    expect(home.leadTitle(w, "marketing")).toBe("Marketing lead");
  });

  it("refuses a bad lead name", () => {
    const { workspace } = seedWorkspace();
    expect(() => home.addLeads(workspace.id, ["Bad Name"])).toThrow(
      /lowercase/
    );
    expect(hasLeads(workspace.id)).toBe(false);
  });

  it("tells each standing session apart by its token", () => {
    const { w, marketing } = withLeads();
    const tech = getOrchestrator(w)!;
    const t1 = home.standingToken(tech.id);
    const t2 = home.standingToken(marketing.id);
    expect(t1).not.toBe(t2);
    expect(home.standingToken(tech.id)).toBe(t1);
    expect(home.standingByToken(w, t1)?.id).toBe(tech.id);
    expect(home.standingByToken(w, t2)?.id).toBe(marketing.id);
    expect(home.standingByToken(w, "nope")).toBeNull();
    expect(home.standingByToken(seedWorkspace().workspace.id, t2)).toBeNull();
  });
});

describe("profiles", () => {
  it("leaves the orchestrator of a workspace without leads exactly as it was", () => {
    const { workspace } = seedWorkspace();
    const p = profileFor(home.addLeads(workspace.id, [])[0], false)!;
    expect(p.kind).toBe("tech");
    expect(p.leadTools).toEqual([]);
    expect(p.tools).toContain("sign_off");
  });

  it("keeps merging Tech's only", () => {
    const { w, marketing } = withLeads();
    const tech = profileFor(getOrchestrator(w)!, true)!;
    const m = profileFor(marketing, true)!;
    expect(tech.leadTools).toContain("update_memo");
    for (const t of ["sign_off", "arm", "land", "review", "quick_pr"])
      expect(m.tools).not.toContain(t);
    expect(m.tools).toContain("start_task");
    expect(m.inArea).toBe(true);
  });
});

describe("a lead's tool calls", () => {
  it("refuses Tech's tools and unknown ones", async () => {
    const { w, marketing } = withLeads();
    await expect(
      runStandingTool(w, marketing, "sign_off", { task: "x" })
    ).rejects.toBeInstanceOf(NotYours);
    await expect(
      runStandingTool(w, marketing, "nonsense", {})
    ).rejects.toBeInstanceOf(UnknownTool);
  });

  it("keeps starts inside its area, and fails closed", async () => {
    const { w, app, api } = withLeads();
    setLeadAreas(w, "marketing", [{ kind: "project", value: app.id }]);
    expect(
      areaRefusal(w, "marketing", "start_task", { project: app.name })
    ).toBeNull();
    expect(
      areaRefusal(w, "marketing", "start_task", { project: api.name })
    ).toMatch(/isn't in your area/);
    expect(
      areaRefusal(w, "marketing", "stop", { session: "missing" })
    ).toBeTruthy();
    // A board in its area covers the project on it.
    setLeadAreas(w, "marketing", [{ kind: "board", value: "Roadmap" }]);
    expect(
      areaRefusal(w, "marketing", "stack", { target: app.name })
    ).toBeNull();
  });

  it("refuses a start outside its area before running it", async () => {
    const { w, marketing, api } = withLeads();
    await expect(
      runStandingTool(w, marketing, "start_task", {
        project: api.name,
        prompt: "x",
      })
    ).rejects.toThrow(/isn't in your area/);
  });

  it("writes its memo and records its notes as its own", async () => {
    const { w, marketing } = withLeads();
    await runStandingTool(w, marketing, "update_memo", {
      text: "On the launch page",
    });
    expect(latestMemo(w, "marketing")?.text).toBe("On the launch page");
    await runStandingTool(w, marketing, "note", {
      text: "Picked the headline",
    });
    const row = db
      .prepare(
        `SELECT lead_kind FROM orchestrator_notes WHERE workspace_id = ? AND text = 'Picked the headline'`
      )
      .get(w) as { lead_kind: string };
    expect(row.lead_kind).toBe("marketing");
    expect(
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM chat_items WHERE session_id = ? AND kind = 'note'`
          )
          .get(marketing.id) as { n: number }
      ).n
    ).toBe(1);
  });

  it("proposes only the owner's own words", async () => {
    const { w, marketing } = withLeads();
    saveItem(marketing.id, {
      id: "u1",
      kind: "user",
      text: "Lead with the free tier",
      createdAt: Date.now(),
    } as never);
    saveItem(marketing.id, {
      id: "a1",
      kind: "assistant",
      text: "I will",
      createdAt: Date.now(),
    } as never);
    await runStandingTool(w, marketing, "propose_pin", { item: "u1" });
    await expect(
      runStandingTool(w, marketing, "propose_pin", { item: "a1" })
    ).rejects.toThrow();
    expect(openProposals(w, "marketing").map((p) => p.quote)).toEqual([
      "Lead with the free tier",
    ]);
  });

  it("keeps a note outside any lead as Tech's", () => {
    const { w, marketing } = withLeads();
    addNote(w, "tech note");
    asActor(marketing, () => addNote(w, "marketing note"));
    const kinds = db
      .prepare(
        `SELECT text, lead_kind FROM orchestrator_notes WHERE workspace_id = ? ORDER BY id`
      )
      .all(w) as { text: string; lead_kind: string }[];
    expect(kinds.find((n) => n.text === "tech note")?.lead_kind).toBe("tech");
    expect(kinds.find((n) => n.text === "marketing note")?.lead_kind).toBe(
      "marketing"
    );
  });
});

describe("a lead's brief and digest", () => {
  it("names its tools without Tech's, and its charter", () => {
    const { w, workspace, marketing } = withLeads();
    const brief = leadBrief({
      workspace: workspace.name,
      workspaceId: w,
      kind: "marketing",
      profile: profileFor(marketing, true)!,
      projects: [],
    });
    expect(brief).toContain("You are the Marketing lead");
    expect(brief).toContain("mcp__agentos__update_memo");
    expect(brief).toContain("mcp__agentos__start_task");
    expect(brief).not.toMatch(/sign_off`|__arm`|__land`|quick_pr/);
    expect(brief).not.toContain("### Tiers");
    expect(brief).toContain("## Your charter");
  });

  it("adds a lead section to Tech's brief only when there are leads", () => {
    const { w, workspace } = withLeads();
    const tech = getOrchestrator(w)!;
    const lead = techLeadAdditions(tech);
    expect(lead.section).toContain("Marketing lead");
    const input = { workspace: workspace.name, workspaceId: w, projects: [] };
    const plain = orchestratorBrief(input);
    const withLead = orchestratorBrief({ ...input, lead: lead.section });
    expect(withLead).toContain(lead.section);
    expect(plain).not.toContain("You are the Tech lead");
  });

  it("carries direction, memo, asks and work across a fresh start", () => {
    const { w, marketing, app } = withLeads();
    writeMemo(w, "marketing", "Drafting the pricing page");
    asActor(marketing, () =>
      raiseAsk({
        workspaceId: w,
        subject: "copy",
        kind: "decision",
        title: "Which headline?",
        leadKind: "marketing",
      })
    );
    const started = seedSession({
      projectId: app.id,
      name: "landing-copy",
      task: true,
    });
    updateSessionRow(db, started, { started_by: marketing.id });
    const digest = buildLeadDigest(w, "marketing", { sessionId: marketing.id });
    expect(digest).toContain("Drafting the pricing page");
    expect(digest).toContain("Which headline?");
    expect(digest).toContain("landing-copy");
    const tech = buildLeadDigest(w, "tech", {
      sessionId: getOrchestrator(w)!.id,
      tech: true,
    });
    expect(tech).not.toContain("Which headline?");
  });
});

describe("answering a lead's ask", () => {
  it("goes to that lead's chat, not the orchestrator's events", async () => {
    const { w, marketing } = withLeads();
    const { ask } = raiseAsk({
      workspaceId: w,
      subject: "copy-2",
      kind: "decision",
      title: "Ship the new tagline?",
      leadKind: "marketing",
    });
    answerAsk(w, ask.id, { action: "approve" });
    await vi.waitFor(() =>
      expect(sent.map((s) => s.id)).toContain(marketing.id)
    );
    const events = db
      .prepare(
        `SELECT COUNT(*) AS n FROM orchestrator_events WHERE workspace_id = ?`
      )
      .get(w) as { n: number };
    expect(events.n).toBe(0);
  });
});

describe("adopting a chat as a lead", () => {
  function chat(projectId: string) {
    const id = seedSession({ projectId, name: "planning", view: "chat" });
    updateSessionRow(db, id, { agent_type: "claude" });
    saveItem(id, {
      id: `u-${randomUUID()}`,
      kind: "user",
      text: "Post weekly, never daily",
      createdAt: Date.now(),
    } as never);
    return id;
  }

  it("keeps the session and its chat, and asks for a memo and pins", async () => {
    const { workspace, app } = seedWorkspace();
    const w = workspace.id;
    const id = chat(app.id);
    const s = await adoptLead({
      sessionId: id,
      workspaceId: w,
      kind: "marketing",
    });
    expect(s).toMatchObject({
      id,
      role: "lead",
      lead_kind: "marketing",
      workspace_id: w,
    });
    expect(stopped).toEqual([id]);
    expect(sent[0].id).toBe(id);
    expect(sent[0].text).toMatch(/\[item u-.*\] Post weekly, never daily/);
    expect(getOrchestrator(w)?.lead_kind).toBe("tech");
    await expect(
      adoptLead({ sessionId: chat(app.id), workspaceId: w, kind: "marketing" })
    ).rejects.toThrow(/already has/);
  });

  it("refuses mid-turn, Tech, tasks and standing sessions", async () => {
    const { workspace, app, task } = seedWorkspace();
    const w = workspace.id;
    await expect(
      adoptLead({ sessionId: chat(app.id), workspaceId: w, kind: "tech" })
    ).rejects.toThrow(/orchestrator/);
    await expect(
      adoptLead({ sessionId: task, workspaceId: w, kind: "marketing" })
    ).rejects.toThrow();
    state = "running";
    await expect(
      adoptLead({ sessionId: chat(app.id), workspaceId: w, kind: "marketing" })
    ).rejects.toThrow(/turn/);
    state = null;
    home.addLeads(w, []);
    await expect(
      adoptLead({
        sessionId: getOrchestrator(w)!.id,
        workspaceId: w,
        kind: "marketing",
      })
    ).rejects.toThrow(/already heads/);
  });

  it("switches over only once the memo is written, on the owner's tap", async () => {
    const { workspace, app } = seedWorkspace();
    const w = workspace.id;
    const id = chat(app.id);
    await adoptLead({ sessionId: id, workspaceId: w, kind: "product" });
    const item = `u-${randomUUID()}`;
    saveItem(id, {
      id: item,
      kind: "user",
      text: "Mobile first",
      createdAt: Date.now(),
    } as never);
    const lead = home.getLead(w, "product")!;
    await runStandingTool(w, lead, "propose_pin", { item });
    const [proposal] = openProposals(w, "product");
    await expect(
      confirmPins({
        workspaceId: w,
        kind: "product",
        confirm: [proposal.id],
        switchOver: true,
      })
    ).rejects.toThrow(/memo/);
    await runStandingTool(w, lead, "update_memo", { text: "Roadmap for Q1" });
    const out = await confirmPins({
      workspaceId: w,
      kind: "product",
      confirm: [proposal.id],
      switchOver: true,
    });
    expect(out.fresh).toBe("now");
    expect(fresh).toEqual([id]);
    expect(currentDirection(w, "product").map((p) => p.quote)).toEqual([
      "Mobile first",
    ]);
  });
});
