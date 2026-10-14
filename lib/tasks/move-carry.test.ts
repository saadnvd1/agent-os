import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { db } from "../db";
import { seedOrchestrator } from "../orchestrator/testing";
import { hasHeldMirrors } from "./held-replies";
import { CARRIED_COLUMNS, KEPT, REKEYED, carryTaskState } from "./move-carry";

const KEYS = /^(session_id|target|subject|after_task|after_any|task_id)$/;
const ORCHESTRATION_TABLE = /^(orchestrator_|brief_|task_|check_|away_)/;

describe("what a move re-keys", () => {
  it("covers every orchestrator table that names a session, or says why not", () => {
    const decided = new Set<string>(
      [...REKEYED, ...KEPT].map(([t, c]) => `${t}.${c}`)
    );
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all() as { name: string }[];
    const undecided: string[] = [];
    for (const { name } of tables) {
      if (!ORCHESTRATION_TABLE.test(name)) continue;
      const cols = db.prepare(`PRAGMA table_info(${name})`).all() as {
        name: string;
      }[];
      for (const c of cols)
        if (KEYS.test(c.name) && !decided.has(`${name}.${c.name}`))
          undecided.push(`${name}.${c.name}`);
    }
    expect(undecided).toEqual([]);
  });

  it("only names tables and columns that exist", () => {
    for (const [table, col] of [...REKEYED, ...KEPT]) {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
      }[];
      expect(
        cols.map((c) => c.name),
        `${table}.${col}`
      ).toContain(col);
    }
    const cols = (
      db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[]
    ).map((c) => c.name);
    for (const c of CARRIED_COLUMNS) expect(cols).toContain(c);
  });
});

function seedSession(id: string, extra = "") {
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status ${extra ? ", " + extra.split("=")[0] : ""}) VALUES (?, 't', ?, '/tmp', 'running' ${extra ? ", ?" : ""})`
  ).run(...[id, `claude-${id}`, ...(extra ? [extra.split("=")[1]] : [])]);
}

describe("carryTaskState", () => {
  it("moves the orchestrator's records to the new id and leaves history alone", () => {
    const from = randomUUID();
    const to = randomUUID();
    const other = randomUUID();
    seedOrchestrator("orch-1");
    seedSession(from, "started_by=orch-1");
    seedSession(to);
    const w = "w-carry";
    db.prepare(
      `INSERT INTO orchestrator_starts (workspace_id, kind, target, created_at) VALUES (?, 'task', ?, 'x'), (?, 'task', ?, 'x')`
    ).run(w, from, w, other);
    db.prepare(
      `INSERT INTO orchestrator_checks (workspace_id, session_id, sha, kind, status) VALUES (?, ?, 'abc', 'review', 'pass')`
    ).run(w, from);
    db.prepare(
      `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count) VALUES (?, 'ci', ?, 1)`
    ).run(from, w);
    db.prepare(
      `INSERT INTO orchestrator_gate_failure_commits (session_id, gate, sha, workspace_id) VALUES (?, 'ci', 'abc', ?)`
    ).run(from, w);
    db.prepare(
      `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title) VALUES (?, ?, 'merge', 'ok?')`
    ).run(w, `task:${from}`);
    db.prepare(
      `INSERT INTO brief_amendments (session_id, workspace_id, text) VALUES (?, ?, 'also X')`
    ).run(from, w);
    db.prepare(
      `INSERT INTO task_pr_wakes (session_id, key, kind) VALUES (?, 'k', 'review')`
    ).run(from);
    db.prepare(
      `INSERT INTO orchestrator_events (workspace_id, key, subject, line, created_at) VALUES (?, ?, ?, 'l', 'x'), (?, ?, ?, 'l', 'x')`
    ).run(w, `blocked:${from}`, from, w, `once:plan-done:${from}`, from);
    db.prepare(
      `INSERT INTO orchestrator_event_log (workspace_id, subject, delivered_at) VALUES (?, ?, 'x')`
    ).run(w, from);
    db.prepare(
      `INSERT INTO task_queue (id, project_id, prompt, position, after_task) VALUES (?, 'p', 'q', 1, ?)`
    ).run(randomUUID(), from);
    db.prepare(
      `UPDATE sessions SET model_overrides = 'x/y', merge_armed_at = 't', pr_number = 7 WHERE id = ?`
    ).run(from);

    carryTaskState(from, to);

    const count = (sql: string, ...a: unknown[]) =>
      (db.prepare(sql).get(...a) as { n: number }).n;
    expect(
      count(`SELECT COUNT(*) n FROM orchestrator_starts WHERE target = ?`, to)
    ).toBe(1);
    expect(
      count(
        `SELECT COUNT(*) n FROM orchestrator_starts WHERE target = ?`,
        other
      )
    ).toBe(1);
    for (const sql of [
      `SELECT COUNT(*) n FROM orchestrator_checks WHERE session_id = ?`,
      `SELECT COUNT(*) n FROM orchestrator_gate_failures WHERE session_id = ?`,
      `SELECT COUNT(*) n FROM orchestrator_gate_failure_commits WHERE session_id = ?`,
      `SELECT COUNT(*) n FROM brief_amendments WHERE session_id = ?`,
      `SELECT COUNT(*) n FROM task_pr_wakes WHERE session_id = ?`,
      `SELECT COUNT(*) n FROM task_queue WHERE after_task = ?`,
    ]) {
      expect(count(sql, to), sql).toBe(1);
      expect(count(sql, from), sql).toBe(0);
    }
    expect(
      count(
        `SELECT COUNT(*) n FROM orchestrator_asks WHERE subject = ?`,
        `task:${to}`
      )
    ).toBe(1);
    expect(
      db
        .prepare(
          `SELECT key FROM orchestrator_events WHERE subject = ? ORDER BY key`
        )
        .all(to)
    ).toEqual([{ key: `blocked:${to}` }, { key: `once:plan-done:${to}` }]);
    // History is never rewritten.
    expect(
      count(
        `SELECT COUNT(*) n FROM orchestrator_event_log WHERE subject = ?`,
        from
      )
    ).toBe(1);
    expect(
      db
        .prepare(
          `SELECT started_by, model_overrides, merge_armed_at, pr_number, task_since FROM sessions WHERE id = ?`
        )
        .get(to)
    ).toMatchObject({
      started_by: "orch-1",
      model_overrides: "x/y",
      merge_armed_at: "t",
      pr_number: 7,
    });
    // Its start time survives, for a PR opened before the move.
    expect(
      (
        db.prepare(`SELECT task_since FROM sessions WHERE id = ?`).get(to) as {
          task_since: string;
        }
      ).task_since
    ).toBeTruthy();
  });

  it("is safe to run again, and never overwrites what the new row has", () => {
    const from = randomUUID();
    const to = randomUUID();
    seedSession(from, "started_by=old");
    seedSession(to, "started_by=new");
    carryTaskState(from, to);
    carryTaskState(from, to);
    expect(
      (
        db.prepare(`SELECT started_by FROM sessions WHERE id = ?`).get(to) as {
          started_by: string;
        }
      ).started_by
    ).toBe("new");
  });

  it("carries the orchestrator, never a plain task, as who holds the moved task", () => {
    seedOrchestrator("orch-m");
    const plain = randomUUID();
    seedSession(plain);
    const viaPlain = randomUUID();
    const viaOrch = randomUUID();
    seedSession(viaPlain, `started_by=${plain}`);
    seedSession(viaOrch, "started_by=orch-m");
    const heldBy = (id: string) =>
      (
        db.prepare(`SELECT started_by FROM sessions WHERE id = ?`).get(id) as {
          started_by: string | null;
        }
      ).started_by;
    for (const [src, want] of [
      [viaPlain, null],
      [viaOrch, "orch-m"],
    ] as const) {
      const mirror = randomUUID();
      seedSession(mirror);
      db.prepare(
        `UPDATE sessions SET host_id = 'h-carry', task_prompt = 'x' WHERE id = ?`
      ).run(mirror);
      carryTaskState(src, mirror);
      expect(heldBy(mirror)).toBe(want);
    }
    // Only the orchestrator's mirror counts as held for replies.
    expect(hasHeldMirrors("h-carry")).toBe(true);
    db.prepare(
      `UPDATE sessions SET task_status = 'merged' WHERE host_id = 'h-carry' AND started_by IS NOT NULL`
    ).run();
    expect(hasHeldMirrors("h-carry")).toBe(false);
  });
});
