import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

const lookups: string[] = [];
vi.mock("./pr-poll", () => ({
  lookupPR: async (_repo: string, branch: string) => {
    lookups.push(branch);
    return null;
  },
}));
vi.mock("../status-detector", () => ({
  statusDetector: {
    getStatus: async () => "dead",
    capturePane: async () => "",
  },
}));
vi.mock("../lumifyhub/task-cards", () => ({
  attachTaskCard: async () => {},
  inBackground: () => {},
  syncTaskCardInBackground: () => {},
  taskCardUrl: () => null,
}));

const { db, insertSessionRow } = await import("../db");
const { createProject } = await import("../projects");
const { listTasks } = await import("./index");

function seed(
  status: string,
  branch: string,
  extra: { pr?: number; prStatus?: string; archived?: boolean } = {}
): string {
  const project = createProject({
    name: `p-${crypto.randomUUID().slice(0, 6)}`,
    workingDirectory: mkdtempSync(join(tmpdir(), "list-tasks-")),
  });
  const id = crypto.randomUUID();
  insertSessionRow(db, {
    id,
    name: "task",
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    project_id: project.id,
    task_status: status,
    branch_name: branch,
    base_branch: "main",
    pr_number: extra.pr ?? null,
    pr_url: extra.pr ? `https://github.com/o/r/pull/${extra.pr}` : null,
    pr_status: extra.prStatus ?? null,
    archived_at: extra.archived ? "2026-10-07 10:00:00" : null,
  });
  return id;
}

describe("listTasks", () => {
  it("asks gh only about running tasks, and skips archived ones", async () => {
    const running = seed("running", "feature/live");
    const merged = seed("merged", "feature/merged", {
      pr: 8,
      prStatus: "merged",
    });
    const dropped = seed("dropped", "feature/dropped", {
      pr: 9,
      prStatus: "closed",
    });
    const archived = seed("merged", "feature/old", { archived: true });

    const tasks = await listTasks();
    const ids = tasks.map((t) => t.id);

    expect(lookups).toEqual(["feature/live"]);
    expect(ids).toEqual(expect.arrayContaining([running, merged, dropped]));
    expect(ids).not.toContain(archived);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    expect(byId.get(merged)?.pr).toMatchObject({ number: 8, state: "MERGED" });
    expect(byId.get(merged)?.state).toBe("merged");
    expect(byId.get(dropped)?.pr).toMatchObject({ number: 9, state: "CLOSED" });
  });
});
