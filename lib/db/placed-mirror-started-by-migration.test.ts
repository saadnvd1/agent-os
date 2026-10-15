import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";

describe("placed_mirror_started_by migration", () => {
  it("fills a remote mirror's orchestrator from the queue, and nothing else", () => {
    const d = new Database(":memory:");
    createSchema(d);
    runMigrations(d, "20261014T0900_task_scheduling");
    d.prepare(
      `INSERT INTO projects (id, name, working_directory) VALUES ('p', 'P', '/tmp/p')`
    ).run();
    d.prepare(
      `INSERT INTO hosts (id, name, ssh_target) VALUES ('h', 'box', 'x')`
    ).run();
    d.prepare(
      `INSERT INTO task_queue (id, project_id, prompt, position, started_by) VALUES ('m', 'p', 'x', 1, 'orch'), ('l', 'p', 'x', 2, 'orch')`
    ).run();
    for (const [id, host] of [
      ["m", "h"],
      ["l", "local"],
    ])
      d.prepare(
        `INSERT INTO sessions (id, name, tmux_name, working_directory, host_id, task_prompt, task_status)
         VALUES (?, 'n', ?, '/tmp', ?, 'x', 'running')`
      ).run(id, `claude-${id}`, host);
    runMigrations(d);
    runMigrations(d);
    const by = (id: string) =>
      d
        .prepare(`SELECT started_by, task_since FROM session_rows WHERE id = ?`)
        .get(id) as {
        started_by: string | null;
        task_since: string | null;
      };
    expect(by("m").started_by).toBe("orch");
    expect(by("m").task_since).toBeTruthy();
    expect(by("l").started_by).toBeNull();
  });
});
