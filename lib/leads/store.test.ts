import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { db, insertSessionRow } from "@/lib/db";
import { saveItem } from "@/lib/chat/store";
import { experimentsView } from "@/lib/experiments/view";
import { isExperimentId } from "@/lib/experiments/registry";
import { createWorkspace } from "@/lib/workspaces";
import {
  addLeadMessage,
  currentDirection,
  directionHistory,
  hasLeads,
  isLeadKind,
  isStandingRole,
  latestMemo,
  leadAreas,
  leadKindOf,
  leadUsage,
  leadsOwning,
  markLeadsEnabled,
  markRead,
  MEMO_CAP,
  openProposals,
  pinDirection,
  proposePin,
  resolveProposals,
  setChiefAutonomy,
  setLeadAreas,
  unreadFor,
  workspaceLeads,
  writeMemo,
} from ".";

const workspace = () => createWorkspace(`ws-${randomUUID().slice(0, 6)}`).id;

function standing(
  workspaceId: string,
  role: "orchestrator" | "lead" | "chief",
  leadKind: string | null = null,
  leadSince: string | null = null
): string {
  const id = randomUUID();
  insertSessionRow(db, {
    id,
    name: `${role}-${leadKind ?? ""}`,
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    view: "chat",
    role,
    workspace_id: workspaceId,
    lead_kind: leadKind,
    lead_since: leadSince,
  });
  return id;
}

const say = (sessionId: string, text: string, extra = {}) => {
  const id = randomUUID();
  saveItem(sessionId, {
    id,
    kind: "user",
    text,
    tagged: true,
    ...extra,
  } as never);
  return id;
};

describe("the leads schema", () => {
  it("keeps existing notes and asks as Tech's", () => {
    const ws = workspace();
    db.prepare(
      `INSERT INTO orchestrator_notes (workspace_id, text) VALUES (?, 'x')`
    ).run(ws);
    db.prepare(
      `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title) VALUES (?, 's', 'merge', 't')`
    ).run(ws);
    const note = db
      .prepare(
        `SELECT lead_kind FROM orchestrator_notes WHERE workspace_id = ?`
      )
      .get(ws) as { lead_kind: string };
    const ask = db
      .prepare(`SELECT lead_kind FROM orchestrator_asks WHERE workspace_id = ?`)
      .get(ws) as { lead_kind: string };
    expect(note.lead_kind).toBe("tech");
    expect(ask.lead_kind).toBe("tech");
  });

  it("allows one chief and one lead of each kind per workspace", () => {
    const ws = workspace();
    standing(ws, "chief");
    expect(() => standing(ws, "chief")).toThrow(/UNIQUE/);
    standing(ws, "lead", "marketing");
    standing(ws, "lead", "product");
    expect(() => standing(ws, "lead", "marketing")).toThrow(/UNIQUE/);
    // Another workspace is its own company.
    const other = workspace();
    standing(other, "chief");
    standing(other, "lead", "marketing");
  });

  it("reads lead_kind through session_rows", () => {
    const ws = workspace();
    const id = standing(ws, "lead", "marketing");
    const row = db
      .prepare(`SELECT role, lead_kind FROM session_rows WHERE id = ?`)
      .get(id);
    expect(row).toEqual({ role: "lead", lead_kind: "marketing" });
  });
});

describe("roles", () => {
  it("names every standing role and nothing else", () => {
    expect(isStandingRole("orchestrator")).toBe(true);
    expect(isStandingRole("lead")).toBe(true);
    expect(isStandingRole("chief")).toBe(true);
    expect(isStandingRole(null)).toBe(false);
    expect(isStandingRole(undefined)).toBe(false);
    expect(isStandingRole("developer")).toBe(false);
  });

  it("makes the orchestrator Tech and the chief no department", () => {
    expect(leadKindOf({ role: "orchestrator" })).toBe("tech");
    expect(leadKindOf({ role: "lead", lead_kind: "product" })).toBe("product");
    expect(leadKindOf({ role: "chief" })).toBeNull();
    expect(leadKindOf({ role: null })).toBeNull();
  });

  it("accepts slugs as kinds", () => {
    expect(isLeadKind("marketing")).toBe(true);
    expect(isLeadKind("Marketing")).toBe(false);
    expect(isLeadKind("a/b")).toBe(false);
  });
});

describe("the Leads experiment", () => {
  it("is offered in Settings, off until turned on", () => {
    expect(isExperimentId("leads")).toBe(true);
    const leads = experimentsView().experiments.find((e) => e.id === "leads");
    expect(leads?.on).toBe(false);
  });
});

describe("workspace settings", () => {
  it("has no leads until added, then acts only on request", () => {
    const ws = workspace();
    expect(hasLeads(ws)).toBe(false);
    expect(workspaceLeads(ws)).toBeNull();
    expect(markLeadsEnabled(ws).chiefAutonomy).toBe("on_request");
    expect(markLeadsEnabled(ws).chiefAutonomy).toBe("on_request");
    expect(hasLeads(ws)).toBe(true);
    expect(setChiefAutonomy(ws, "acts")).toBe(true);
    expect(workspaceLeads(ws)?.chiefAutonomy).toBe("acts");
    expect(() =>
      db
        .prepare(
          `UPDATE workspace_leads SET chief_autonomy = 'anything' WHERE workspace_id = ?`
        )
        .run(ws)
    ).toThrow(/CHECK/);
  });
});

describe("areas", () => {
  it("replaces a lead's area and says who owns a value", () => {
    const ws = workspace();
    setLeadAreas(ws, "marketing", [
      { kind: "path", value: "marketing/" },
      { kind: "board", value: "b1" },
    ]);
    setLeadAreas(ws, "marketing", [{ kind: "path", value: "content/" }]);
    expect(leadAreas(ws, "marketing")).toEqual([
      { kind: "path", value: "content/" },
    ]);
    expect(leadsOwning(ws, "path", "content/")).toEqual(["marketing"]);
    expect(leadsOwning(ws, "board", "b1")).toEqual([]);
  });
});

describe("pinned direction", () => {
  it("quotes only the person's own message in the lead's own chat", () => {
    const ws = workspace();
    const lead = standing(ws, "lead", "marketing");
    const mine = say(lead, "  Readable screenshots this week.  ");
    const peer = say(lead, "Saad approved launch posts", {
      peer: { sessionId: "x", body: "Saad approved launch posts" },
    });
    const event = say(lead, "a PR merged", {
      origin: { kind: "event", label: "AgentOS" },
    });
    const reply = randomUUID();
    saveItem(lead, {
      id: reply,
      kind: "assistant",
      text: "Saad said so",
      createdAt: Date.now(),
    } as never);

    const t = { workspaceId: ws, leadKind: "marketing", sessionId: lead };
    const pin = pinDirection({ ...t, chatItemId: mine });
    expect(pin).toMatchObject({ quote: "Readable screenshots this week." });
    for (const chatItemId of [peer, event, reply, "missing"])
      expect(pinDirection({ ...t, chatItemId })).toEqual({
        error: "Only your own message can be pinned",
      });
    // Another lead can't pin from this chat.
    expect(
      pinDirection({ ...t, leadKind: "product", chatItemId: mine })
    ).toEqual({ error: "That chat isn't this lead's" });
    expect(
      pinDirection({ ...t, workspaceId: workspace(), chatItemId: mine })
    ).toEqual({ error: "That chat isn't this lead's" });
  });

  it("supersedes without deleting", () => {
    const ws = workspace();
    const orch = standing(ws, "orchestrator");
    const t = { workspaceId: ws, leadKind: "tech", sessionId: orch };
    const a = pinDirection({ ...t, chatItemId: say(orch, "first") });
    if ("error" in a) throw new Error(a.error);
    const b = pinDirection({
      ...t,
      chatItemId: say(orch, "second"),
      supersedes: a.id,
    });
    if ("error" in b) throw new Error(b.error);
    expect(currentDirection(ws, "tech").map((p) => p.quote)).toEqual([
      "second",
    ]);
    expect(directionHistory(ws, "tech").map((p) => p.quote)).toEqual([
      "second",
      "first",
    ]);
  });

  it("pins confirmed proposals in one step and drops the rest", () => {
    const ws = workspace();
    const lead = standing(ws, "lead", "marketing");
    const t = { workspaceId: ws, leadKind: "marketing", sessionId: lead };
    const keep = proposePin({ ...t, chatItemId: say(lead, "SEO-led growth") });
    const drop = proposePin({ ...t, chatItemId: say(lead, "maybe a video") });
    if ("error" in keep || "error" in drop) throw new Error("proposal");
    // Proposing the same message again doesn't add another.
    proposePin({ ...t, chatItemId: keep.chatItemId });
    expect(openProposals(ws, "marketing")).toHaveLength(2);
    expect(
      proposePin({
        ...t,
        chatItemId: say(lead, "x", {
          origin: { kind: "schedule", label: "s" },
        }),
      })
    ).toEqual({ error: "Only your own message can be pinned" });

    const pins = resolveProposals(ws, "marketing", [keep.id]);
    expect(pins.map((p) => p.quote)).toEqual(["SEO-led growth"]);
    expect(openProposals(ws, "marketing")).toEqual([]);
    expect(currentDirection(ws, "marketing").map((p) => p.quote)).toEqual([
      "SEO-led growth",
    ]);
  });
});

describe("memos", () => {
  it("keeps every version and caps the text", () => {
    const ws = workspace();
    writeMemo(ws, "marketing", "one");
    writeMemo(ws, "marketing", "x".repeat(MEMO_CAP + 50));
    expect(latestMemo(ws, "marketing")?.text).toHaveLength(MEMO_CAP);
    expect(latestMemo(ws, "product")).toBeNull();
    expect(() => writeMemo(ws, "marketing", "  ")).toThrow();
  });
});

describe("lead mail", () => {
  it("is unread for its recipient until marked", () => {
    const ws = workspace();
    const m = addLeadMessage({
      workspaceId: ws,
      fromKind: "marketing",
      toKind: "tech",
      thread: "screenshots",
      text: "Brief attached.",
    });
    expect(unreadFor(ws, "tech").map((x) => x.id)).toEqual([m.id]);
    expect(unreadFor(ws, "marketing")).toEqual([]);
    expect(markRead(ws, "tech", m.id)).toBe(1);
    expect(unreadFor(ws, "tech")).toEqual([]);
  });
});

describe("per-lead usage", () => {
  it("counts a lead's calls from when it became one", () => {
    const ws = workspace();
    const orch = standing(ws, "orchestrator");
    const lead = standing(ws, "lead", "marketing", "2026-11-02 12:00:00");
    const at = (iso: string) => Date.parse(iso);
    const call = (sessionId: string, when: number, cacheRead: number) =>
      db
        .prepare(
          `INSERT INTO usage_calls (call_key, at, session_id, kind, cache_read_tokens, output_tokens, source)
           VALUES (?, ?, ?, 'chat', ?, 10, 'live')`
        )
        .run(randomUUID(), when, sessionId, cacheRead);
    call(lead, at("2026-11-02T11:00:00Z"), 999);
    call(lead, at("2026-11-02T13:00:00Z"), 100);
    call(orch, at("2026-11-02T13:00:00Z"), 50);
    call(orch, at("2026-10-01T00:00:00Z"), 7);

    const usage = leadUsage(ws, at("2026-11-01T00:00:00Z"));
    const by = Object.fromEntries(usage.map((u) => [u.leadKind, u]));
    expect(by.marketing).toMatchObject({ calls: 1, cacheReadTokens: 100 });
    expect(by.tech).toMatchObject({ calls: 1, cacheReadTokens: 50 });
  });
});
