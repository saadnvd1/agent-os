import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";

const { db, insertSessionRow } = await import("@/lib/db");
const { GET } = await import("./route");

describe("GET /api/tasks payload", () => {
  it("lists hasPrompt, not the prompt text, and leaves null fields out", async () => {
    const id = randomUUID();
    insertSessionRow(db, {
      id,
      name: "t",
      tmux_name: `claude-${id}`,
      working_directory: "/tmp",
      task_status: "running",
      task_prompt: "p".repeat(5000),
    });
    const { tasks } = await (await GET()).json();
    const t = tasks.find((x: { id: string }) => x.id === id);
    expect(t.hasPrompt).toBe(true);
    expect(t).not.toHaveProperty("prompt");
    expect(JSON.stringify(t)).not.toContain("ppppp");
    expect(Object.values(t)).not.toContain(null);
  });
});

describe("taskSessions with a merged limit", () => {
  it("keeps the most recently merged ones and every unmerged one", async () => {
    const { taskSessions } = await import("@/lib/tasks/session");
    const add = (status: string, merged_at: string | null) => {
      const id = randomUUID();
      insertSessionRow(db, {
        id,
        name: "t",
        tmux_name: `claude-${id}`,
        working_directory: "/tmp",
        task_status: status,
        merged_at,
      });
      return id;
    };
    const oldest = add("merged", "2020-01-01 00:00:00");
    const newer = add("merged", "2020-01-03 00:00:00");
    const newest = add("merged", "2020-01-04 00:00:00");
    const running = add("running", null);
    const ids = taskSessions(false, 2).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([newer, newest, running]));
    expect(ids).not.toContain(oldest);
  });
});
