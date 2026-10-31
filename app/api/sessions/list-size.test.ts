import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";

const { db, insertSessionRow } = await import("@/lib/db");
const { GET } = await import("./route");

type Row = Record<string, unknown> & { id: string };

function seed(extra: Record<string, unknown> = {}): string {
  const id = randomUUID();
  insertSessionRow(db, {
    id,
    name: "n",
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    ...extra,
  });
  return id;
}

const list = async (query = "") => {
  const res = await GET({
    nextUrl: new URL(`http://x/api/sessions${query}`),
  } as never);
  return (await res.json()).sessions as Row[];
};

beforeEach(() => {
  db.prepare(`DELETE FROM sessions`).run();
});

describe("GET /api/sessions payload", () => {
  it("never carries the prompt text, the chat context or the orchestrator token", async () => {
    const id = seed({
      task_status: "running",
      task_prompt: "x".repeat(5000),
      chat_context: "ctx",
      orch_token: "secret-token",
    });
    const row = (await list()).find((r) => r.id === id)!;
    expect(row).not.toHaveProperty("task_prompt");
    expect(row).not.toHaveProperty("chat_context");
    expect(row).not.toHaveProperty("orch_token");
    expect(row.has_prompt).toBe(1);
  });

  it("says has_prompt 0 for a plain session", async () => {
    const id = seed();
    expect((await list()).find((r) => r.id === id)!.has_prompt).toBe(0);
  });

  it("leaves null fields out", async () => {
    const id = seed();
    const row = (await list()).find((r) => r.id === id)!;
    expect(Object.values(row)).not.toContain(null);
    expect(row).not.toHaveProperty("pr_url");
  });

  it("lists the 100 most recent merged tasks, all with ?done=all", async () => {
    for (let i = 0; i < 103; i++) {
      const day = String(i + 1).padStart(3, "0");
      seed({
        task_status: "merged",
        merged_at: `2026-01-01 00:00:${i % 60}`.replace(/:(\d)$/, ":0$1"),
        updated_at: `2026-02-01 00:00:00`,
        name: `done-${day}`,
      });
    }
    const live = seed({ task_status: "running" });
    const capped = await list();
    expect(capped.filter((r) => r.task_status === "merged")).toHaveLength(100);
    expect(capped.map((r) => r.id)).toContain(live);
    const all = await list("?done=all");
    expect(all.filter((r) => r.task_status === "merged")).toHaveLength(103);
  });
});
