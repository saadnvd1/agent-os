import path from "path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createSchema } from "./schema";
import { runMigrations } from "./migrations";
import { tempDir } from "@/lib/test-temp";

describe("migration 20261018T2130_project_tier", () => {
  it("makes LumifyHub and Workstak projects production, the rest fast, and keeps a later change", () => {
    const dir = tempDir("project-tier-");
    const db = new Database(path.join(dir, "old.db"));
    createSchema(db);
    runMigrations(db, "20261018T2100_orch_full_access");
    const ws = (id: string, name: string) =>
      db
        .prepare(`INSERT INTO workspaces (id, name) VALUES (?, ?)`)
        .run(id, name);
    ws("w1", "LumifyHub");
    ws("w2", "Workstak");
    ws("w3", "Internal Tools");
    const project = (name: string, workspace: string | null) =>
      db
        .prepare(
          `INSERT INTO projects (id, name, working_directory, workspace_id) VALUES (?, ?, '/tmp/x', ?)`
        )
        .run(name, name, workspace);
    project("lumifyhub-rails", "w1");
    project("k8s-lh", "w1");
    project("workstak-app", "w2");
    project("lumifyhub-growth", null);
    project("dashboards", "w3");
    project("AgentOS", null);

    runMigrations(db);
    const tiers = () =>
      Object.fromEntries(
        (
          db.prepare(`SELECT name, tier FROM projects`).all() as {
            name: string;
            tier: string;
          }[]
        ).map((r) => [r.name, r.tier])
      );
    expect(tiers()).toEqual({
      "lumifyhub-rails": "production",
      "k8s-lh": "production",
      "workstak-app": "production",
      "lumifyhub-growth": "production",
      dashboards: "fast",
      AgentOS: "fast",
      Scratch: "fast",
    });

    db.prepare(
      `UPDATE projects SET tier = 'production' WHERE name = 'dashboards'`
    ).run();
    db.prepare(`UPDATE projects SET tier = 'fast' WHERE name = 'k8s-lh'`).run();
    db.prepare(
      `DELETE FROM _migrations WHERE key = '20261018T2130_project_tier'`
    ).run();
    runMigrations(db);
    expect(tiers().dashboards).toBe("production");
    expect(tiers()["k8s-lh"]).toBe("fast");
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM fast_lane_tasks`).get()
    ).toEqual({ n: 0 });
    db.close();
  });
});
