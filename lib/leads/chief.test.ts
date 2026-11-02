import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem, ChatOrigin } from "@/lib/chat/events";
import type { UsageState } from "@/lib/orchestrator/usage";

const sent: { id: string; text: string; origin?: ChatOrigin }[] = [];
vi.mock("@/lib/chat/runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat/runner")>()),
  sendChat: async (id: string, m: { text: string; origin?: ChatOrigin }) => {
    sent.push({ id, text: m.text, origin: m.origin });
  },
}));

const bus: { fromId: string; to: string; line: string }[] = [];
vi.mock("@/lib/bus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bus")>()),
  sendMessage: async (m: { fromId: string; to: string; line: string }) => {
    bus.push(m);
    return { delivery: { state: "delivered" } };
  },
}));

let usage: UsageState = { window: null };
vi.mock("@/lib/orchestrator/usage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/orchestrator/usage")>()),
  readUsage: () => usage,
}));

const { db } = await import("@/lib/db");
const { saveItem } = await import("@/lib/chat/store");
const { setExperiment } = await import("@/lib/experiments");
const { seedSession, seedWorkspace } =
  await import("@/lib/orchestrator/testing");
const { getOrchestrator } = await import("@/lib/orchestrator/home");
const { listSchedules } = await import("@/lib/schedules/store");
const home = await import("./home");
const { adoptLead } = await import("./adopt");
const { profileFor, profileHas } = await import("./profiles");
const { runStandingTool } = await import("./tools");
const { pinDirection } = await import("./direction");
const { writeMemo } = await import("./memos");
const { setLeadAreas } = await import("./charters");
const { addLeadMessage } = await import("./messages");
const { setChiefAutonomy } = await import("./settings");
const { AREA_THREAD } = await import("./area-notify");
const { directionView } = await import("./direction-view");
const { COMPANY_TOKENS, companyText } = await import("./company");
const { chiefBrief, chiefView, ownerAsked, turnPrompt } =
  await import("./chief");
const { chiefSlotSkip, SWEEP_CRON } = await import("./sweep");
const { CHIEF } = await import("./order");
const { resolveTarget } = await import("@/lib/bus/targets");

beforeEach(() => {
  sent.length = 0;
  bus.length = 0;
  usage = { window: null };
  db.prepare(`DELETE FROM settings WHERE key LIKE 'experiments.%'`).run();
  setExperiment("leads", true);
});

function company(kinds = ["marketing"]) {
  const seeded = seedWorkspace();
  const w = seeded.workspace.id;
  home.addLeads(w, kinds);
  return {
    ...seeded,
    w,
    chief: home.getChief(w)!,
    tech: getOrchestrator(w)!,
    marketing: home.getLead(w, "marketing")!,
  };
}

let at = Date.now();
function say(sessionId: string, item: Partial<ChatItem> & { kind: string }) {
  const id = `${item.kind}-${randomUUID()}`;
  saveItem(sessionId, {
    id,
    createdAt: at++,
    text: "",
    ...item,
  } as ChatItem);
  return id;
}
const owner = (s: string, text: string, midTurn = false) =>
  say(s, { kind: "user", text, tagged: true, midTurn });
const schedule = (s: string) =>
  say(s, {
    kind: "user",
    text: "Your daily sweep.",
    tagged: true,
    origin: { kind: "schedule", label: "Chief of staff daily sweep" },
  });

describe("the chief of staff", () => {
  it("is made once, by Add leads, with its daily sweep", () => {
    const { w, chief } = company();
    expect(chief.role).toBe("chief");
    expect(chief.lead_kind).toBeNull();
    expect(chief.pinned).toBeTruthy();
    home.addLeads(w, ["product"]);
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM sessions WHERE workspace_id = ? AND role = 'chief'`
        )
        .get(w)
    ).toEqual({ n: 1 });
    const sweeps = listSchedules(w).filter(
      (s) => s.target_session_id === chief.id
    );
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0]).toMatchObject({ kind: "message", cron: SWEEP_CRON });
    expect(home.getLead(w, CHIEF)?.id).toBe(chief.id);
  });

  it("answers to <workspace>/chief on the bus", () => {
    const { workspace, chief } = company();
    expect(resolveTarget(`${workspace.name}/chief`).session.id).toBe(chief.id);
  });

  it("isn't a lead kind anyone can add or adopt", async () => {
    const { w, app } = company();
    expect(() => home.addLeads(w, ["chief"])).toThrow(/chief already/);
    const s = seedSession({ projectId: app.id, name: "a chat" });
    await expect(
      adoptLead({ sessionId: s, workspaceId: w, kind: "chief" })
    ).rejects.toThrow(/made by Add leads/);
  });

  it("has the workspace's tools and company, never review or merges", () => {
    const { chief, marketing, tech } = company();
    const p = profileFor(chief, true)!;
    expect(p.kind).toBe(CHIEF);
    expect(p.inArea).toBe(false);
    for (const t of ["company", "message_lead", "message_orchestrator"])
      expect(profileHas(p, t)).toBe(true);
    for (const t of ["review", "sign_off", "arm", "land", "quick_pr", "done"])
      expect(profileHas(p, t)).toBe(false);
    for (const t of ["update_memo", "propose_pin"])
      expect(profileHas(p, t)).toBe(false);
    expect(profileHas(profileFor(marketing, true)!, "company")).toBe(false);
    expect(profileHas(profileFor(tech, true)!, "company")).toBe(false);
  });

  it("has no direction strip of its own, and its own header", () => {
    const { chief, marketing } = company();
    expect(directionView(chief.id)).toBeNull();
    expect(chiefView(marketing.id)).toBeNull();
    expect(chiefView(chief.id)).toMatchObject({
      autonomy: "on_request",
      sweep: { when: "Every day at 8:00 AM" },
    });
    setExperiment("leads", false);
    expect(chiefView(chief.id)).toBeNull();
  });
});

describe("the chief acts only when the owner asks", () => {
  const regroup = (w: string, chief: Parameters<typeof runStandingTool>[1]) =>
    runStandingTool(w, chief, "set_group", { session: "worker", group: null });

  it("reads, notes and asks in a turn the sweep started, and acts in none", async () => {
    const { w, chief, app } = company();
    seedSession({ projectId: app.id, name: "worker" });
    schedule(chief.id);
    await expect(regroup(w, chief)).rejects.toThrow(/act only when/);
    await expect(
      runStandingTool(w, chief, "message_lead", {
        to: "marketing",
        thread: "Launch",
        text: "hold it",
      })
    ).rejects.toThrow(/act only when/);
    expect(await runStandingTool(w, chief, "company", {})).toContain(
      "Marketing lead"
    );
    await runStandingTool(w, chief, "note", {
      text: "Marketing waits on Tech",
    });
    const note = db
      .prepare(
        `SELECT lead_kind FROM orchestrator_notes WHERE workspace_id = ? ORDER BY id DESC`
      )
      .get(w);
    expect(note).toEqual({ lead_kind: "chief" });
  });

  it("acts on the owner's own message, and tells the lead whose area it is", async () => {
    const { w, chief, app, marketing } = company();
    setLeadAreas(w, "marketing", [{ kind: "project", value: app.id }]);
    seedSession({ projectId: app.id, name: "worker" });
    owner(chief.id, "Take the worker out of its group");
    expect(await regroup(w, chief)).toMatch(/out of its group/);
    const told = sent.filter((m) => m.id === marketing.id);
    expect(told).toHaveLength(1);
    expect(told[0].text).toContain("the Chief of staff");
    expect(told[0].text).toContain("in your area as the Marketing lead");
    expect(told[0].origin?.mail).toMatchObject({
      thread: AREA_THREAD,
      from: CHIEF,
      to: "marketing",
    });
  });

  it("tells Tech when no lead owns the project", async () => {
    const { w, chief, api, tech } = company();
    seedSession({ projectId: api.id, name: "worker" });
    owner(chief.id, "Ungroup the worker");
    await regroup(w, chief);
    expect(sent.map((m) => m.id)).toEqual([tech.id]);
  });

  it("waits for the turn a mid-turn message starts", () => {
    const { chief } = company();
    schedule(chief.id);
    const late = owner(chief.id, "Stop the worker", true);
    expect(ownerAsked(chief.id)).toBe(false);
    say(chief.id, { kind: "turn_end" });
    expect(turnPrompt(chief.id)?.id).toBe(late);
    expect(ownerAsked(chief.id)).toBe(true);
    // A lead's mail arriving during the owner's turn doesn't take it over,
    // and starts a turn of its own that can't act.
    say(chief.id, {
      kind: "user",
      text: "mail",
      tagged: true,
      midTurn: true,
      origin: { kind: "peer", label: "Marketing lead" },
    });
    expect(ownerAsked(chief.id)).toBe(true);
    say(chief.id, { kind: "turn_end" });
    expect(ownerAsked(chief.id)).toBe(false);
  });

  it("acts without being asked only once its autonomy is lifted", async () => {
    const { w, chief, app } = company();
    seedSession({ projectId: app.id, name: "worker" });
    schedule(chief.id);
    setChiefAutonomy(w, "acts");
    await expect(regroup(w, chief)).resolves.toMatch(/out of its group/);
  });
});

describe("company()", () => {
  it("reads its own workspace's records, never a lead's chat", () => {
    const { w, marketing } = company(["marketing", "product"]);
    const other = company();
    say(marketing.id, { kind: "assistant", text: "SECRET-CHAT-LINE" });
    const item = owner(marketing.id, "SEO-led growth, no launch posts");
    pinDirection({
      workspaceId: w,
      leadKind: "marketing",
      sessionId: marketing.id,
      chatItemId: item,
    });
    writeMemo(w, "marketing", "Drafting the What's New");
    writeMemo(other.w, "marketing", "OTHER-WORKSPACE-MEMO");
    addLeadMessage({
      workspaceId: w,
      fromKind: "marketing",
      toKind: "tech",
      thread: "Screenshots",
      text: "THREAD-BODY",
    });
    const text = companyText(w);
    expect(text).toContain("SEO-led growth, no launch posts");
    expect(text).toContain("Drafting the What's New");
    expect(text).toContain('"Screenshots": marketing and tech, 1 message');
    expect(text).toContain("Product lead");
    for (const hidden of [
      "SECRET-CHAT-LINE",
      "OTHER-WORKSPACE-MEMO",
      "THREAD-BODY",
    ])
      expect(text).not.toContain(hidden);
  });

  it("opens a thread on request and stays inside its budget", async () => {
    const { w, chief } = company();
    for (let i = 0; i < 40; i++)
      writeMemo(w, "marketing", `memo ${i} ${"x".repeat(2000)}`);
    for (let i = 0; i < 30; i++)
      addLeadMessage({
        workspaceId: w,
        fromKind: "marketing",
        toKind: "tech",
        thread: `Topic ${i}`,
        text: "y".repeat(1000),
      });
    expect(companyText(w).length).toBeLessThanOrEqual(COMPANY_TOKENS * 4);
    const thread = await runStandingTool(w, chief, "company", {
      thread: "Topic 3",
    });
    expect(thread).toContain('Thread "Topic 3"');
    expect(thread).toContain("marketing to tech");
    await expect(
      runStandingTool(w, chief, "company", { thread: "Nope" })
    ).rejects.toThrow(/No thread/);
  });
});

describe("other workspaces, through the orchestrators' messaging", () => {
  it("reaches the other chief when it has one, else its orchestrator", async () => {
    const a = company();
    const b = company();
    const c = seedWorkspace();
    owner(a.chief.id, "Tell the others");
    await runStandingTool(a.w, a.chief, "message_orchestrator", {
      workspace: b.workspace.name,
      message: "hello",
    });
    expect(bus[0]).toMatchObject({ fromId: a.chief.id, to: b.chief.id });
    expect(bus[0].line).toContain("from the chief of staff of the");
    home.addLeads(c.workspace.id, []);
    db.prepare(
      `DELETE FROM sessions WHERE workspace_id = ? AND role = 'chief'`
    ).run(c.workspace.id);
    await runStandingTool(a.w, a.chief, "message_orchestrator", {
      workspace: c.workspace.name,
      message: "hi",
    });
    expect(bus[1].to).toBe(getOrchestrator(c.workspace.id)!.id);
  });
});

describe("the daily sweep", () => {
  it("skips a slot only while the usage window is known to run out", () => {
    const { w, chief } = company();
    const sweep = listSchedules(w).find(
      (s) => s.target_session_id === chief.id
    )!;
    expect(chiefSlotSkip(sweep)).toBeNull();
    usage = { unknown: "not sampled" };
    expect(chiefSlotSkip(sweep)).toBeNull();
    usage = {
      window: { pct: 92, resetsIn: 7200, burnPerMin: 1, capsIn: 600 },
    };
    expect(chiefSlotSkip(sweep)).toMatch(/usage window/);
    expect(chiefSlotSkip({ ...sweep, target_session_id: null })).toBeNull();
  });

  it("tells the chief its acting tools refuse in a scheduled turn", () => {
    const { w, chief } = company();
    const brief = chiefBrief({
      workspace: "Acme",
      workspaceId: w,
      profile: profileFor(chief, true)!,
      autonomy: "on_request",
      projects: [],
      leads: [{ kind: "marketing", title: "Marketing lead" }],
    });
    expect(brief).toContain("chief of staff");
    expect(brief).toContain("acting tools refuse");
    expect(brief).toContain("mcp__");
    expect(brief).toContain("company");
    expect(brief).not.toContain("sign_off`");
  });
});
