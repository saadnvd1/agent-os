import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { recentPicks } from "./recent";

let n = 0;
function add(
  project: string,
  agent: string,
  model: string | null,
  at: string,
  over: { role?: string; host?: string } = {}
) {
  const id = `rp-${++n}`;
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO projects (id, name, working_directory) VALUES (?, ?, '/tmp')`
    )
    .run(project, project);
  getDb()
    .prepare(
      `INSERT INTO sessions (id, name, tmux_name, working_directory, project_id,
         agent_type, model, created_at, host_id, agent_role)
       VALUES (?, ?, ?, '/tmp', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      id,
      id,
      project,
      agent,
      model,
      at,
      over.host ?? "local",
      over.role ?? null
    );
}

beforeEach(() => {
  getDb().prepare(`DELETE FROM sessions WHERE id LIKE 'rp-%'`).run();
  getDb().prepare(`DELETE FROM projects WHERE id IN ('p1','p2','p3')`).run();
});

describe("recentPicks", () => {
  it("lists a project's latest agent and model pairs, newest first, once each", () => {
    add("p1", "claude", "opus", "2026-10-01 10:00:00");
    add("p1", "copilot", "gpt-6", "2026-10-02 10:00:00");
    add("p1", "claude", "opus", "2026-10-03 10:00:00");
    add("p1", "claude", "sonnet", "2026-10-04 10:00:00");
    expect(recentPicks("p1")).toEqual([
      { agent: "claude", model: "sonnet" },
      { agent: "claude", model: "opus" },
      { agent: "copilot", model: "gpt-6" },
    ]);
  });

  it("ignores other projects, other machines, roles and sessions without a model", () => {
    add("p2", "claude", "opus", "2026-10-01 10:00:00");
    add("p3", "codex", "gpt", "2026-10-02 10:00:00");
    add("p2", "codex", "gpt", "2026-10-03 10:00:00", { host: "box" });
    add("p2", "codex", "gpt", "2026-10-04 10:00:00", { role: "analyst" });
    add("p2", "codex", null, "2026-10-05 10:00:00");
    expect(recentPicks("p2")).toEqual([{ agent: "claude", model: "opus" }]);
  });

  it("is empty with no project", () => {
    expect(recentPicks(null)).toEqual([]);
  });
});
