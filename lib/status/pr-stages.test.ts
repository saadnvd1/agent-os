import { describe, expect, it, vi } from "vitest";
import type { TaskPR } from "@/lib/tasks/state";

let cached: TaskPR | null | undefined;
vi.mock("@/lib/tasks/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/session")>()),
  cachedPR: () => cached,
}));

const { db } = await import("@/lib/db");
const { seedSession, seedWorkspace } =
  await import("@/lib/orchestrator/testing");
const { putCheck } = await import("@/lib/orchestrator/checks");
const { addPrStages } = await import("./pr-stages");

const open = (over: Partial<TaskPR> = {}): TaskPR => ({
  number: 7,
  url: "https://example.test/pull/7",
  state: "OPEN",
  checks: "none",
  head: "abcdef1234567",
  mergeable: "MERGEABLE",
  ...over,
});

function task() {
  const { workspace, app } = seedWorkspace();
  const id = seedSession({ projectId: app.id, name: "t", task: true });
  db.prepare(
    `UPDATE sessions SET pr_number = 7, pr_status = 'open' WHERE id = ?`
  ).run(id);
  return { id, workspaceId: workspace.id };
}
const stageOf = (id: string) => {
  const statuses = { [id]: { sessionName: "x", status: "idle" as const } };
  addPrStages(statuses);
  return (statuses[id] as { prStage?: { stage: string } }).prStage?.stage;
};

describe("addPrStages", () => {
  it("reads the cached PR, the stored review and the armed flag", () => {
    const { id, workspaceId } = task();
    cached = open({ checks: "pending" });
    expect(stageOf(id)).toBe("ci-running");
    cached = open();
    expect(stageOf(id)).toBe("open");
    putCheck({
      workspaceId,
      sessionId: id,
      sha: "abcdef1234567",
      kind: "review",
      status: "running",
    });
    expect(stageOf(id)).toBe("review-running");
    putCheck({
      workspaceId,
      sessionId: id,
      sha: "abcdef1234567",
      kind: "review",
      status: "pass",
    });
    db.prepare(
      `UPDATE sessions SET merge_armed_at = datetime('now') WHERE id = ?`
    ).run(id);
    expect(stageOf(id)).toBe("armed");
  });

  it("falls back to the stored PR before a poll, and skips non-tasks", () => {
    const { id } = task();
    cached = undefined;
    expect(stageOf(id)).toBe("open");
    const statuses = { nobody: { sessionName: "x", status: "idle" as const } };
    addPrStages(statuses);
    expect(statuses.nobody).not.toHaveProperty("prStage");
  });
});
