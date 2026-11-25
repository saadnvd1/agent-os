import os from "os";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { tempDir } from "@/lib/test-temp";

vi.mock("@/lib/status-detector", () => ({
  checkWaitingPatterns: () => false,
  statusDetector: {
    refreshCache: async () => {},
    sessionExists: () => true,
    getStatus: async () => "idle",
    titleFor: () => "",
    getTimestamp: () => 0,
    hostFor: () => "local",
    foregroundFor: () => undefined,
    paneProcess: () => undefined,
    capturePane: async () => "",
  },
}));

const { db, updateSessionRow } = await import("@/lib/db");
const { ensureOrchestrator } = await import("./home");
const { runTool } = await import("./serve");
const { seedWorkspace, seedSession } = await import("./testing");
const { orchestratorOverview } = await import("./overview");
const { openAskCount } = await import("./asks");
const { queueEvent } = await import("./events");
const { deliverEvents, BATCH_WINDOW_MS } = await import("./deliver");
const {
  dismissItem,
  resolveQuestion,
  undismissItem,
  MAX_OPEN_QUESTIONS,
  taskHasOpenQuestion,
} = await import("./questions");
const { buildDigest } = await import("./digest");

const age = (id: number | bigint, modifier: string) =>
  db
    .prepare(
      `UPDATE orchestrator_questions SET created_at = datetime('now', ?) WHERE id = ?`
    )
    .run(modifier, id);
const rowOf = (id: number) =>
  db
    .prepare(
      `SELECT status, resolved_by FROM orchestrator_questions WHERE id = ?`
    )
    .get(id);

beforeAll(() => {
  const home = tempDir("aos-orch-questions-");
  vi.spyOn(os, "homedir").mockReturnValue(home);
});

function workspace() {
  const ws = seedWorkspace();
  ensureOrchestrator(ws.workspace.id);
  const w = ws.workspace.id;
  const overview = () =>
    orchestratorOverview().find((o) => o.workspaceId === w)!;
  return { ...ws, w, overview };
}

describe("open questions", () => {
  it("opens a question, lists it, and clears it", async () => {
    const t = workspace();
    await expect(
      runTool(t.w, "question", { text: "Ship the beta Friday?" })
    ).resolves.toMatch(/Question \d+ is open/);
    const [q] = t.overview().questions;
    expect(q).toMatchObject({ text: "Ship the beta Friday?", task: null });
    await expect(runTool(t.w, "resolve_question", { id: q.id })).resolves.toBe(
      `Question ${q.id} cleared.`
    );
    expect(t.overview().questions).toEqual([]);
    await expect(
      runTool(t.w, "resolve_question", { id: q.id })
    ).resolves.toMatch(/No open question/);
  });

  it("treats the same words while open as the same question", async () => {
    const t = workspace();
    await runTool(t.w, "question", { text: "Which one?" });
    await expect(
      runTool(t.w, "question", { text: "Which one?" })
    ).resolves.toMatch(/already open/);
    expect(t.overview().questions).toHaveLength(1);
  });

  it("caps how many stay open", async () => {
    const t = workspace();
    for (let i = 0; i < MAX_OPEN_QUESTIONS; i++)
      await runTool(t.w, "question", { text: `q${i}` });
    await expect(
      runTool(t.w, "question", { text: "one more" })
    ).resolves.toMatch(/Not opened/);
  });

  it("refuses at the cap with the open list and evicts nothing", async () => {
    const t = workspace();
    for (let i = 0; i < MAX_OPEN_QUESTIONS; i++)
      await runTool(t.w, "question", { text: `old thing ${i}` });
    const ids = t.overview().questions.map((q) => q.id);
    age(ids[0], "-2 days");
    const out = await runTool(t.w, "question", { text: "one more" });
    expect(out).toMatch(/Not opened/);
    expect(out).toContain("resolve_question");
    for (const id of ids) expect(out).toContain(`[question ${id}]`);
    expect(out).toContain("old thing 3");
    expect(out).toContain("2d ago");
    expect(t.overview().questions).toHaveLength(MAX_OPEN_QUESTIONS);
    await runTool(t.w, "resolve_question", { id: ids[0] });
    await expect(
      runTool(t.w, "question", { text: "one more" })
    ).resolves.toMatch(/is open/);
  });

  it("does not count expired questions toward the cap", async () => {
    const t = workspace();
    for (let i = 0; i < MAX_OPEN_QUESTIONS; i++)
      await runTool(t.w, "question", { text: `q${i}` });
    for (const q of t.overview().questions) age(q.id, "-4 days");
    await expect(runTool(t.w, "question", { text: "fresh" })).resolves.toMatch(
      /is open/
    );
  });

  it("expires a question after 3 days and not before", async () => {
    const t = workspace();
    await runTool(t.w, "question", { text: "Almost stale?" });
    await runTool(t.w, "question", { text: "Stale?" });
    const [stale, almost] = t.overview().questions.map((q) => q.id);
    age(almost, "-71 hours");
    age(stale, "-4321 minutes");
    expect(t.overview().questions.map((q) => q.id)).toEqual([almost]);
    expect(rowOf(stale)).toEqual({ status: "expired", resolved_by: "expired" });
    expect(rowOf(almost)).toEqual({ status: "open", resolved_by: null });
  });

  it("expires on brief build too", async () => {
    const t = workspace();
    await runTool(t.w, "question", { text: "Ancient question" });
    const [q] = t.overview().questions;
    age(q.id, "-5 days");
    expect(buildDigest(t.w)).not.toContain("Ancient question");
    expect(rowOf(q.id)).toEqual({ status: "expired", resolved_by: "expired" });
  });

  it("lists open questions in the brief", async () => {
    const t = workspace();
    expect(buildDigest(t.w)).toMatch(/### Open questions[^\n]*\n- None\./);
    await runTool(t.w, "question", { text: "Ship the beta Friday?" });
    const [q] = t.overview().questions;
    expect(buildDigest(t.w)).toContain(
      `- [question ${q.id}] just now: Ship the beta Friday?`
    );
  });

  it("reads open and recently resolved questions with the questions tool", async () => {
    const t = workspace();
    const other = workspace();
    const task = seedSession({
      projectId: t.app.id,
      name: "billing",
      task: true,
    });
    expect(await runTool(t.w, "questions", {})).toBe("No open questions.");
    await runTool(t.w, "question", { text: "Older one", task: "billing" });
    await runTool(t.w, "question", { text: "Newer one" });
    await runTool(other.w, "question", { text: "Not mine" });
    const [newer, older] = t.overview().questions;
    age(older.id, "-2 days");
    const out = await runTool(t.w, "questions", {});
    expect(out).toContain(
      `[question ${older.id}] 2d ago: Older one | task billing`
    );
    expect(out).toContain(`[question ${newer.id}] just now: Newer one`);
    expect(out.indexOf("Older one")).toBeLessThan(out.indexOf("Newer one"));
    expect(out).not.toContain("Not mine");
    expect(out).not.toContain("Resolved in the last");
    expect(task).toBeTruthy();

    resolveQuestion(t.w, newer.id, "saad");
    age(older.id, "-4 days");
    const recent = await runTool(t.w, "questions", { recent: true });
    expect(recent).toContain(`[question ${newer.id}] answered`);
    expect(recent).toContain(`[question ${older.id}] expired`);
    expect(recent).toContain("No open questions.");
  });

  it("taskHasOpenQuestion ignores a question past expiry", async () => {
    const t = workspace();
    const id = seedSession({ projectId: t.app.id, name: "tq", task: true });
    await runTool(t.w, "question", { text: "About tq?", task: "tq" });
    expect(taskHasOpenQuestion(id)).toBe(true);
    const [q] = t.overview().questions;
    age(q.id, "-4 days");
    expect(taskHasOpenQuestion(id)).toBe(false);
  });

  it("resolves when the owner answers, and not for another workspace", async () => {
    const t = workspace();
    const other = workspace();
    await runTool(t.w, "question", { text: "Merge it?" });
    const [q] = t.overview().questions;
    expect(resolveQuestion(other.w, q.id, "saad")).toBe(false);
    expect(resolveQuestion(t.w, q.id, "saad")).toBe(true);
    const row = db
      .prepare(
        `SELECT status, resolved_by FROM orchestrator_questions WHERE id = ?`
      )
      .get(q.id);
    expect(row).toEqual({ status: "answered", resolved_by: "saad" });
  });

  it("clears a question about a task that has finished", async () => {
    const t = workspace();
    const id = seedSession({
      projectId: t.app.id,
      name: "billing",
      task: true,
    });
    await runTool(t.w, "question", {
      text: "Keep the old API?",
      task: "billing",
    });
    expect(t.overview().questions).toMatchObject([
      { task: id, taskName: "billing" },
    ]);
    updateSessionRow(db, id, { task_status: "merged" });
    expect(t.overview().questions).toEqual([]);
  });
});

describe("dismissing from the strip", () => {
  it("hides an item without resolving it", async () => {
    const t = workspace();
    await runTool(t.w, "ask_owner", {
      title: "Pay for the domain?",
      detail: "Why",
      kind: "money",
    });
    const [ask] = t.overview().asks;
    dismissItem(t.w, `ask:${ask.id}`);
    expect(t.overview().dismissed).toEqual([`ask:${ask.id}`]);
    // Still open, still counted.
    expect(t.overview().asks).toHaveLength(1);
    expect(openAskCount(t.w)).toBe(1);
    undismissItem(t.w, `ask:${ask.id}`);
    expect(t.overview().dismissed).toEqual([]);
  });
});

describe("event delivery", () => {
  it("records which tasks an update is about on its origin", async () => {
    const t = workspace();
    const orch = ensureOrchestrator(t.w);
    const id = seedSession({
      projectId: t.app.id,
      name: "billing",
      task: true,
    });
    queueEvent(t.w, "ci:billing", id, "task billing: CI green");
    const origins: unknown[] = [];
    await deliverEvents({
      workspaceId: t.w,
      orchestratorId: orch.id,
      turn: "idle",
      send: async (_id, input) => {
        origins.push(input.origin);
      },
      now: Date.now() + BATCH_WINDOW_MS + 1,
    });
    expect(origins).toMatchObject([
      { kind: "event", subjects: [{ id, name: "billing" }] },
    ]);
  });
});
