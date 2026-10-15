import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { db, insertSessionRow, queries } from "@/lib/db";
import { listArchived } from "@/lib/done/archive";
import { taskSessions } from "@/lib/tasks/session";

function seed(
  extra: {
    task_status?: string;
    archived?: boolean;
    brief?: string;
    prompt?: string;
  } = {}
): string {
  const id = randomUUID();
  insertSessionRow(db, {
    id,
    name: "n",
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    task_status: extra.task_status ?? null,
    archived_at: extra.archived ? "2026-10-07 10:00:00" : null,
    task_brief: extra.brief ?? null,
    system_prompt: extra.prompt ?? null,
  });
  return id;
}

const ids = (rows: unknown[]) => (rows as { id: string }[]).map((r) => r.id);

describe("session lists", () => {
  it("getAllSessions keeps every row but drops the large text columns", () => {
    const withBrief = seed({ brief: "do it", prompt: "be brief" });
    const plain = seed({ archived: true });
    const rows = queries.getAllSessions(db).all() as Record<string, unknown>[];
    expect(ids(rows)).toEqual(expect.arrayContaining([withBrief, plain]));
    const row = rows.find((r) => r.id === withBrief)!;
    expect(row).not.toHaveProperty("task_brief");
    expect(row).not.toHaveProperty("system_prompt");
    expect(row.has_brief).toBe(1);
    expect(rows.find((r) => r.id === plain)!.has_brief).toBe(0);
    expect(row.name).toBe("n");
  });

  it("the sidebar list lists merged tasks, and leaves out archived, dropped and moved", () => {
    const keep = [
      seed(),
      seed({ task_status: "running" }),
      seed({ task_status: "merged" }),
    ];
    const gone = [
      seed({ archived: true }),
      seed({ task_status: "merged", archived: true }),
      seed({ task_status: "dropped" }),
      seed({ task_status: "moved" }),
    ];
    const listed = ids(queries.getSidebarSessions(db).all());
    for (const id of keep) expect(listed).toContain(id);
    for (const id of gone) expect(listed).not.toContain(id);
  });

  it("task sessions skip archived ones on request, and never carry the brief", () => {
    const live = seed({ task_status: "running", brief: "b" });
    const old = seed({ task_status: "merged", archived: true });
    const moved = seed({ task_status: "moved" });
    const all = taskSessions();
    expect(ids(all)).toEqual(expect.arrayContaining([live, old]));
    expect(ids(all)).not.toContain(moved);
    expect(all.find((s) => s.id === live)).not.toHaveProperty("task_brief");
    const open = ids(taskSessions(false));
    expect(open).toContain(live);
    expect(open).not.toContain(old);
  });

  it("the archive list holds only archived sessions", () => {
    const archived = seed({ archived: true, brief: "b" });
    const live = seed();
    const listed = listArchived().map((a) => a.id);
    expect(listed).toContain(archived);
    expect(listed).not.toContain(live);
  });
});
