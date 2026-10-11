import { describe, expect, it } from "vitest";
import { db } from "../db";
import { seedWorkspace } from "./testing";
import { addRule } from "./rules";
import { buildDigest, CHARS_PER_TOKEN } from "./digest";

function note(workspaceId: string, text: string, at: string) {
  db.prepare(
    `INSERT INTO orchestrator_notes (workspace_id, kind, text, created_at) VALUES (?, 'note', ?, ?)`
  ).run(workspaceId, text, at);
}

function seed() {
  const s = seedWorkspace();
  const w = s.workspace.id;
  addRule(w, "Never merge #111", "orchestrator");
  addRule(w, "Briefs must not name competitors", "saad");
  db.prepare(
    `UPDATE sessions SET pr_number = 42, pr_status = 'open' WHERE id = ?`
  ).run(s.task);
  db.prepare(
    `INSERT INTO orchestrator_checks (workspace_id, session_id, sha, kind, status)
     VALUES (?, ?, 'aaaaaaa111', 'review', 'block'), (?, ?, 'bbbbbbb222', 'review', 'pass')`
  ).run(w, s.task, w, s.task);
  db.prepare(
    `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count, escalated_at)
     VALUES (?, 'ci', ?, 2, datetime('now'))`
  ).run(s.task, w);
  db.prepare(
    `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title, detail, sha, status)
     VALUES (?, ?, 'decision', 'Merge #42 though CI failed twice?', 'why', 'bbbbbbb222', 'open')`
  ).run(w, `task:${s.task}`);
  db.prepare(
    `INSERT INTO task_queue (id, project_id, prompt, name, after_task, position)
     VALUES ('q-' || ?, ?, 'Do the docs', 'Docs pass', ?, 1)`
  ).run(w, s.app.id, s.task);
  db.prepare(
    `INSERT INTO schedules (id, workspace_id, name, cron, prompt, kind, armed_at)
     VALUES (?, ?, 'Morning report', '0 8 * * *', 'Send the morning report', 'orchestrator', 0)`
  ).run(`sch-${w}`, w);
  note(w, "Older decision", "2026-10-09 10:00:00");
  note(w, "Newest decision", "2026-10-10 10:00:00");
  return { ...s, w };
}

describe("the startup digest", () => {
  it("lays out rules, asks, tasks with gate state, queue, schedules and notes, stably", () => {
    const { w, task } = seed();
    const out = buildDigest(w);
    expect(out).toBe(buildDigest(w));
    const order = [
      "### Standing rules",
      "Never merge #111",
      "Briefs must not name competitors (Saad)",
      "### Open asks",
      `decision: Merge #42 though CI failed twice? | task ${task.slice(0, 8)}@bbbbbbb`,
      "### Running tasks",
      "add-auth (",
      "PR #42 open | review pass@bbbbbbb; ci failed 2x (Saad's now)",
      "### Queued tasks",
      "1. Docs pass (",
      "after add-auth",
      "### Schedules",
      '"Morning report" 0 8 * * * America/Chicago: Send the morning report',
      "### Decision log, newest first",
      "2026-10-10 10:00 UTC: Newest decision",
      "2026-10-09 10:00 UTC: Older decision",
    ];
    let at = 0;
    for (const piece of order) {
      const i = out.indexOf(piece, at);
      expect(i, piece).toBeGreaterThanOrEqual(0);
      at = i + piece.length;
    }
    // Only the newest verdict of a kind counts.
    expect(out).not.toContain("review block");
  });

  it("stays under its budget, newest notes first, and says what it left out", () => {
    const { w } = seed();
    for (let i = 0; i < 150; i++)
      note(
        w,
        `Decision ${String(i).padStart(3, "0")} ${"x".repeat(200)}`,
        `2026-10-10 11:${String(i % 60).padStart(2, "0")}:00`
      );
    const out = buildDigest(w, 1000);
    expect(out.length).toBeLessThanOrEqual(1000 * CHARS_PER_TOKEN);
    expect(out).toContain("Decision 149");
    expect(out).not.toContain("Decision 000");
    expect(out).toMatch(/- \.\.\.and \d+ more\.$/);
    // Everything above the log still made it.
    expect(out).toContain("Never merge #111");
    expect(out).toContain("### Schedules");
  });

  it("closes a fence a cut left open", () => {
    const { workspace } = seedWorkspace();
    note(
      workspace.id,
      `Task said: <untrusted source="x">${"y".repeat(400)}</untrusted> so I waited`,
      "2026-10-10 10:00:00"
    );
    const line = buildDigest(workspace.id).split("\n").at(-1)!;
    expect(line).toMatch(/\.\.\.<\/untrusted>$/);
    expect(line.length).toBeLessThan(360);
  });

  it("says when there's nothing, for the sections that matter empty", () => {
    const { workspace } = seedWorkspace();
    db.prepare(
      `UPDATE sessions SET task_status = 'merged' WHERE project_id IN
      (SELECT id FROM projects WHERE workspace_id = ?)`
    ).run(workspace.id);
    const out = buildDigest(workspace.id);
    expect(out).toContain(
      "### Standing rules\n- None. Keep one with rule_add."
    );
    expect(out).toContain("### Open asks (waiting on Saad)\n- None.");
    expect(out).toContain("### Running tasks\n- None.");
    expect(out).not.toContain("### Schedules");
  });
});

describe("the startup digest with arm-to-merge", () => {
  it("marks a task armed to merge once the column exists", () => {
    const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === "merge_armed_at"))
      db.exec(`ALTER TABLE sessions ADD COLUMN merge_armed_at TEXT`);
    const { workspace, task } = seedWorkspace();
    db.prepare(
      `UPDATE sessions SET pr_number = 7, pr_status = 'open', merge_armed_at = datetime('now') WHERE id = ?`
    ).run(task);
    expect(buildDigest(workspace.id)).toContain("PR #7 open | armed to merge");
  });
});
