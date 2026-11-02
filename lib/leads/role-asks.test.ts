import { randomUUID } from "crypto";
import os from "os";
import Database from "better-sqlite3";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { tempDir } from "@/lib/test-temp";

const { db, insertSessionRow } = await import("@/lib/db");
const { createWorkspace, deleteWorkspace } = await import("@/lib/workspaces");
const { raiseAsk, openAskCount, standingAskCount } =
  await import("@/lib/orchestrator/asks");
const { orchestratorOverview } = await import("@/lib/orchestrator/overview");
const { deletionRefusal } = await import("@/lib/orchestrator/home");
const { chatNeed, needsYou } = await import("@/lib/needs-you");
const migration = (
  await import("@/lib/db/migrations/20261102T2300_needs_you_chat_per_session")
).default;

beforeAll(() => {
  vi.spyOn(os, "homedir").mockReturnValue(tempDir("aos-lead-asks-"));
});

type Role = "orchestrator" | "lead" | "chief";

function standing(workspaceId: string, role: Role, leadKind?: string) {
  const id = randomUUID();
  insertSessionRow(db, {
    id,
    name: `${role}-${leadKind ?? ""}`,
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    view: "chat",
    role,
    workspace_id: workspaceId,
    lead_kind: leadKind ?? null,
  });
  return db
    .prepare(`SELECT * FROM session_rows WHERE id = ?`)
    .get(id) as import("@/lib/db").Session;
}

function team() {
  const w = createWorkspace(`ws-${randomUUID().slice(0, 6)}`).id;
  return {
    w,
    tech: standing(w, "orchestrator"),
    marketing: standing(w, "lead", "marketing"),
    chief: standing(w, "chief"),
  };
}

const ask = (w: string, subject: string, leadKind?: string) =>
  raiseAsk({
    workspaceId: w,
    subject,
    kind: "decision",
    title: `Decide ${subject}`,
    leadKind,
  }).ask;

describe("asks per lead", () => {
  it("are the orchestrator's unless a lead raised them", () => {
    const { w } = team();
    expect(ask(w, "a").lead_kind).toBe("tech");
    expect(ask(w, "b", "marketing").lead_kind).toBe("marketing");
    // The same subject merges into the first one, and stays its lead's.
    expect(ask(w, "a", "marketing").lead_kind).toBe("tech");
    expect(openAskCount(w)).toBe(2);
    expect(openAskCount(w, "tech")).toBe(1);
    expect(openAskCount(w, "marketing")).toBe(1);
  });

  it("show their lead in the overview", () => {
    const { w } = team();
    ask(w, "c", "marketing");
    ask(w, "d");
    const asks = orchestratorOverview().find((o) => o.workspaceId === w)!.asks;
    expect(asks.map((a) => [a.subject, a.leadKind])).toEqual([
      ["c", "marketing"],
      ["d", "tech"],
    ]);
  });

  it("need each lead only for its own", () => {
    const { w, tech, marketing, chief } = team();
    ask(w, "e", "marketing");
    expect(standingAskCount(tech)).toBe(0);
    expect(standingAskCount(marketing)).toBe(1);
    expect(standingAskCount(chief)).toBe(0);
    expect(needsYou(tech, null)).toBe(false);
    expect(needsYou(marketing, null)).toBe(true);
    expect(needsYou(chief, null)).toBe(false);
    expect(chatNeed(marketing, null, 1)).toBe("answer");
    expect(chatNeed(chief, "waiting", 0)).toBe("answer");
  });
});

describe("standing sessions", () => {
  it("can't be deleted alone and go with their workspace", () => {
    const { w, tech, marketing, chief } = team();
    expect(deletionRefusal(tech)).toMatch(/orchestrator can't be deleted/);
    expect(deletionRefusal(marketing)).toMatch(/lead can't be deleted/);
    expect(deletionRefusal(chief)).toMatch(/chief of staff can't be deleted/);
    expect(deletionRefusal({ role: null })).toBeNull();
    deleteWorkspace(w);
    const left = db
      .prepare(`SELECT COUNT(*) AS n FROM sessions WHERE workspace_id = ?`)
      .get(w) as { n: number };
    expect(left.n).toBe(0);
  });
});

describe("needs-you chat key migration", () => {
  it("moves a hidden chat item to the workspace's orchestrator", () => {
    const m = new Database(":memory:");
    m.exec(`
      CREATE TABLE sessions (id TEXT, role TEXT, workspace_id TEXT);
      CREATE TABLE needs_you_dismissed (workspace_id TEXT NOT NULL,
        key TEXT NOT NULL, PRIMARY KEY (workspace_id, key));
      INSERT INTO sessions VALUES ('o1', 'orchestrator', 'w1'), ('t1', NULL, 'w1');
      INSERT INTO needs_you_dismissed VALUES ('w1', 'approval:w1'),
        ('w1', 'ask:3'), ('w2', 'approval:w2');
    `);
    migration.up(m);
    migration.up(m);
    expect(
      m
        .prepare(
          `SELECT workspace_id, key FROM needs_you_dismissed ORDER BY workspace_id, key`
        )
        .all()
    ).toEqual([
      { workspace_id: "w1", key: "approval:o1" },
      { workspace_id: "w1", key: "ask:3" },
      // No orchestrator to move it to: left as it was.
      { workspace_id: "w2", key: "approval:w2" },
    ]);
    m.close();
  });
});
