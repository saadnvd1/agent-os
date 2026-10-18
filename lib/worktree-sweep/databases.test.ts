import { db } from "@/lib/db";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  declaredDatabases,
  dropTaskDatabase,
  findTaskDatabases,
  knownSessionIds,
  liveHashes,
  type DatabaseDeps,
} from "./databases";
import { sessionHash } from "@/lib/project-config/database";
import { createProject } from "@/lib/projects";
import { seedSession } from "@/lib/orchestrator/testing";
import type { PgRun } from "@/lib/project-config/database";

const DAY = 24 * 3600;
const NOW = 1_800_000_000_000;
const deadId = "dead-session";
const aliveId = "alive-session";
const dead = sessionHash(deadId);
const alive = sessionHash(aliveId);
// What the server answers per database: name, size, comment, connections, age.
const said = (id: string) => `agentos session ${id}`;

function fake(rows: string[][], psqlCode = 0) {
  const dropped: string[][] = [];
  const run: PgRun = async (cmd, args) => {
    if (cmd === "dropdb") {
      dropped.push(args);
      return { code: 0, out: "" };
    }
    if (psqlCode) return { code: psqlCode, out: "boom" };
    return { code: 0, out: rows.map((r) => r.join("\t")).join("\n") };
  };
  return { run, dropped };
}

const deps = (run: PgRun, over: Partial<DatabaseDeps> = {}): DatabaseDeps => ({
  now: NOW,
  run,
  servers: [{}],
  live: new Set([alive]),
  known: new Set([alive, dead]),
  froms: new Set(["lumifyhub_development"]),
  ...over,
});
const old = String(NOW / 1000 - 3 * DAY);

describe("finding task databases", () => {
  it("takes a dead session's copy and what was derived from it", async () => {
    const { run } = fake([
      [`app_aos_${dead}`, "100", said(deadId), "0", old],
      [`app_test_aos_${dead}`, "50", "", "0", old],
      [`app_development_aos_${dead}_test`, "25", "", "0", old],
    ]);
    const { candidates } = await findTaskDatabases(
      deps(run, { known: new Set() })
    );
    expect(candidates.map((c) => [c.path, c.bytes])).toEqual([
      [`app_aos_${dead}`, 100],
      [`app_test_aos_${dead}`, 50],
      [`app_development_aos_${dead}_test`, 25],
    ]);
  });

  it("keeps a live session's, a connected one, a young one and a declared source", async () => {
    const { run } = fake([
      [`app_aos_${alive}`, "1", said(aliveId), "0", old],
      [`app_aos_${dead}`, "1", said(deadId), "2", old],
      [`app_test_aos_${dead}`, "1", "", "0", String(NOW / 1000 - 3600)],
      ["lumifyhub_development_aos_" + dead, "1", "", "0", old],
    ]);
    const { candidates, skipped } = await findTaskDatabases(
      deps(run, {
        known: new Set(),
        froms: new Set([`lumifyhub_development_aos_${dead}`]),
      })
    );
    expect(candidates).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual([
      "its session is still running",
      "2 connection(s) open",
      "made less than a day ago",
      "a project's declared source",
    ]);
  });

  it("never looks at a name without the token", async () => {
    // The server is asked only for names with the token; this guards the
    // parse as well, for a server that answers with more.
    const { run } = fake([
      ["agenda", "1", "", "0", old],
      ["crm_test", "1", "", "0", old],
      ["workstak_test_ws_wor_6", "1", "", "0", old],
      ["lumifyhub_aos_short", "1", "", "0", old],
    ]);
    const { candidates, skipped } = await findTaskDatabases(deps(run));
    expect([candidates, skipped]).toEqual([[], []]);
  });

  it("says why a server was skipped", async () => {
    const { run } = fake([], 2);
    const { candidates, skipped } = await findTaskDatabases(deps(run));
    expect(candidates).toEqual([]);
    expect(skipped[0].reason).toMatch(/isn't answering/);
  });

  it("an unknown age still counts, and says so", async () => {
    const { run } = fake([[`app_aos_${dead}`, "7", said(deadId), "0", "0"]]);
    const { candidates } = await findTaskDatabases(deps(run));
    expect(candidates[0].why).toMatch(/age unknown/);
  });
});

describe("proof that AgentOS made it", () => {
  const reasons = async (
    rows: string[][],
    over: Partial<DatabaseDeps> = {}
  ) => {
    const { candidates, skipped } = await findTaskDatabases(
      deps(fake(rows).run, over)
    );
    return {
      names: candidates.map((c) => c.path),
      why: skipped.map((s) => s.reason),
    };
  };

  it("keeps a copy with no AgentOS comment, or another session's", async () => {
    const r = await reasons([
      [`a_aos_${dead}`, "1", "", "0", old],
      [`b_aos_${dead}`, "1", said("someone-else"), "0", old],
      [`c_aos_${dead}`, "1", "my own notes", "0", old],
    ]);
    expect(r.names).toEqual([]);
    expect(r.why).toEqual([
      "no AgentOS comment on it, and its session is known here",
      "its comment names another session",
      "it has a comment that isn't AgentOS's",
    ]);
  });

  it("keeps a derived one whose session this machine knows", async () => {
    const r = await reasons([[`a_test_aos_${dead}`, "1", "", "0", old]]);
    expect(r.names).toEqual([]);
    expect(r.why[0]).toMatch(/its session is known here/);
  });

  it("takes a derived one of an unknown session only on a local server", async () => {
    const rows = [[`a_test_aos_${dead}`, "1", "", "0", old]];
    const unknown = new Set<string>();
    expect(
      (
        await reasons(rows, {
          known: unknown,
          servers: [{ host: "localhost" }],
        })
      ).names
    ).toHaveLength(1);
    const remote = await reasons(rows, {
      known: unknown,
      servers: [{ host: "db.example.com" }],
    });
    expect(remote.names).toEqual([]);
    expect(remote.why).toEqual(["no AgentOS comment, and not a local server"]);
  });
});

describe("dropping", () => {
  it("drops with a plain dropdb, never --force", async () => {
    const { run, dropped } = fake([]);
    const ok = await dropTaskDatabase(
      { path: `app_aos_${dead}`, kind: "database" },
      new Set(),
      run
    );
    expect(ok).toBe(true);
    expect(dropped).toEqual([["--if-exists", `app_aos_${dead}`]]);
  });

  it("refuses a name without the token or a declared source", async () => {
    const { run, dropped } = fake([]);
    for (const name of ["agenda", "crm_test", "lumifyhub_development"])
      expect(
        await dropTaskDatabase(
          { path: name, kind: "database" },
          new Set(["lumifyhub_development"]),
          run
        )
      ).toBe(false);
    expect(
      await dropTaskDatabase(
        { path: `x_aos_${dead}`, kind: "database" },
        new Set([`x_aos_${dead}`]),
        run
      )
    ).toBe(false);
    expect(dropped).toEqual([]);
  });
});

describe("which sessions are live", () => {
  it("is over only for a merged, dropped, done or moved task, or a deleted row", () => {
    const project = createProject({
      name: "live-hashes",
      workingDirectory: process.cwd(),
    });
    const task = (name: string, status: string | null) => {
      const id = seedSession({ projectId: project.id, name });
      if (status)
        db.prepare(
          `INSERT INTO session_tasks (session_id, task_status) VALUES (?, ?)`
        ).run(id, status);
      return id;
    };
    const running = task("running", "running");
    const moving = task("moving", "moving");
    const plain = task("plain", null);
    const archived = task("archived", null);
    db.prepare(
      `UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`
    ).run(archived);
    const archivedTask = task("archived-task", "running");
    db.prepare(
      `UPDATE sessions SET archived_at = datetime('now') WHERE id = ?`
    ).run(archivedTask);
    const over = ["merged", "dropped", "done", "moved"].map((st) =>
      task(st, st)
    );

    const live = liveHashes();
    // Unarchive brings these back, so their databases stay.
    for (const id of [running, moving, plain, archived, archivedTask])
      expect(live.has(sessionHash(id))).toBe(true);
    for (const id of over) expect(live.has(sessionHash(id))).toBe(false);
    expect(knownSessionIds().has(over[0])).toBe(true);
  });
});

describe("declared databases", () => {
  it("asks the default server once, and a project's own host and port too", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-decl-"));
    fs.writeFileSync(
      path.join(dir, "agentos.json"),
      JSON.stringify({ database: { from: "decl_dev" } })
    );
    createProject({ name: "decl", workingDirectory: dir });
    const { servers, froms } = declaredDatabases();
    expect(froms.has("decl_dev")).toBe(true);
    expect(servers.filter((s) => !s.host && !s.port)).toHaveLength(1);
  });
});
