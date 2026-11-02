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
const { dismissItem, resolveQuestion, undismissItem, MAX_OPEN_QUESTIONS } =
  await import("./questions");

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
