import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, insertSessionRow } from "@/lib/db";
import { claudeProjectDir } from "@/lib/tasks/transcript";
import { loadSessions, loadSignals, subagentFiles } from "./sources";

const SINCE = Date.parse("2026-10-10T00:00:00Z");
const UNTIL = Date.parse("2026-10-11T00:00:00Z");
const ID = (n: number) => `0000000${n}-0000-4000-8000-00000000000${n}`;

let home: string;
const db = () => getDb();

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "audit-home-"));
  process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
  for (const t of [
    "sessions",
    "orchestrator_checks",
    "orchestrator_notes",
    "orchestrator_asks",
    "orchestrator_events",
    "orchestrator_gate_failures",
    "bus_messages",
    "chat_turns",
  ])
    db().prepare(`DELETE FROM ${t}`).run();
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  delete process.env.CLAUDE_CONFIG_DIR;
});

function session(row: {
  id: string;
  cwd: string;
  worktree?: string;
  claude?: string;
  role?: string;
  view?: string;
  task?: string;
  host?: string;
  created?: string;
}) {
  insertSessionRow(db(), {
    id: row.id,
    name: `s-${row.id.slice(0, 8)}`,
    working_directory: row.cwd,
    worktree_path: row.worktree ?? null,
    claude_session_id: row.claude ?? null,
    role: row.role ?? null,
    view: row.view ?? "terminal",
    task_prompt: row.task ?? null,
    host_id: row.host ?? "local",
    created_at: row.created ?? "2026-10-01 00:00:00",
  });
}

function transcript(cwd: string, name: string, old = false): string {
  const dir = claudeProjectDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "{}\n");
  if (old) fs.utimesSync(file, new Date("2026-01-01"), new Date("2026-01-01"));
  return file;
}

describe("loadSessions", () => {
  it("gives a worktree all its conversations and a shared folder only the recorded one", () => {
    const worktree = path.join(home, ".agent-os", "worktrees", "proj-fix-1a2b");
    const project = path.join(home, "dev", "proj");
    session({ id: ID(1), cwd: project, worktree, task: "fix it" });
    session({ id: ID(2), cwd: project, claude: ID(8), view: "chat" });
    // Shares the project folder and recorded nothing: none of its files are its.
    session({ id: ID(3), cwd: project });

    const a = transcript(worktree, `${ID(5)}.jsonl`);
    const b = transcript(worktree, `${ID(6)}.jsonl`);
    transcript(worktree, "agent-abc.jsonl");
    const recorded = transcript(project, `${ID(8)}.jsonl`);
    // The user's own session in the same project folder, not AgentOS's.
    transcript(project, `${ID(9)}.jsonl`);

    const found = loadSessions(db(), SINCE - 1e15, home);
    const byId = Object.fromEntries(found.map((s) => [s.id, s]));
    expect(Object.keys(byId).sort()).toEqual([ID(1), ID(2)]);
    expect(byId[ID(1)].kind).toBe("task");
    expect(byId[ID(1)].files.sort()).toEqual([a, b].sort());
    expect(byId[ID(2)]).toMatchObject({ kind: "chat", files: [recorded] });
  });

  it("skips a transcript untouched since the range began, and other machines' sessions", () => {
    const orch = path.join(home, ".agent-os", "orchestrators", "ws1");
    const remote = path.join(
      home,
      ".agent-os",
      "worktrees",
      "proj-remote-9f9f"
    );
    session({ id: ID(1), cwd: orch, role: "orchestrator", view: "chat" });
    session({
      id: ID(2),
      cwd: remote,
      worktree: remote,
      task: "x",
      host: "peer-1",
    });
    const fresh = transcript(orch, `${ID(5)}.jsonl`);
    transcript(orch, `${ID(6)}.jsonl`, true);
    transcript(remote, `${ID(7)}.jsonl`);

    const found = loadSessions(db(), Date.parse("2026-06-01"), home);
    expect(found.map((s) => [s.id, s.kind, s.files])).toEqual([
      [ID(1), "orchestrator", [fresh]],
    ]);
  });

  it("gives a reused folder's conversation to the latest session created before it", () => {
    const orch = path.join(home, ".agent-os", "orchestrators", "ws1");
    session({
      id: ID(1),
      cwd: orch,
      role: "orchestrator",
      created: "2000-01-01 00:00:00",
    });
    session({ id: ID(2), cwd: orch, created: "2099-01-01 00:00:00" });
    const file = transcript(orch, `${ID(5)}.jsonl`);
    const found = loadSessions(db(), 0, home);
    expect(found.map((s) => [s.id, s.files])).toEqual([[ID(1), [file]]]);
  });
});

describe("subagentFiles", () => {
  it("names each subagent's type and scrubs its description", () => {
    const main = path.join(home, "t.jsonl");
    const dir = path.join(home, "t", "subagents");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "agent-a.jsonl"), "{}\n");
    fs.writeFileSync(
      path.join(dir, "agent-a.meta.json"),
      JSON.stringify({
        agentType: "review-security",
        description: "check API_KEY=abc123def",
      })
    );
    expect(subagentFiles(main, 0)).toEqual([
      {
        file: path.join(dir, "agent-a.jsonl"),
        type: "review-security",
        description: "check API_KEY=[redacted]",
      },
    ]);
  });
});

describe("loadSignals", () => {
  it("counts what AgentOS recorded inside the range only, across its time formats", () => {
    session({ id: ID(1), cwd: "/x", role: "orchestrator", view: "chat" });
    session({ id: ID(2), cwd: "/x", task: "t" });
    const run = (sql: string, ...p: unknown[]) =>
      db()
        .prepare(sql)
        .run(...p);
    const IN = "2026-10-10 12:00:00";
    const OUT = "2026-10-09 12:00:00";
    for (const [sha, status, at] of [
      ["a", "pass", IN],
      ["b", "error", IN],
      ["c", "pass", OUT],
    ])
      run(
        `INSERT INTO orchestrator_checks (workspace_id, session_id, sha, kind, status, created_at)
         VALUES ('w', ?, ?, 'review', ?, ?)`,
        ID(2),
        sha,
        status,
        at
      );
    run(
      `INSERT INTO orchestrator_notes (workspace_id, kind, text, created_at) VALUES ('w', 'escalation', 'x', ?)`,
      IN
    );
    run(
      `INSERT INTO orchestrator_notes (workspace_id, kind, text, created_at) VALUES ('w', 'escalation', 'x', ?)`,
      OUT
    );
    run(
      `INSERT INTO orchestrator_events (workspace_id, key, line, hits, created_at) VALUES ('w', 'ci:1', 'task a: idle 12m, no PR', 2, ?)`,
      "2026-10-10T12:00:00.000Z"
    );
    run(
      `INSERT INTO orchestrator_events (workspace_id, key, line, hits, created_at) VALUES ('w', 'ci:2', 'old', 1, ?)`,
      "2026-10-09T12:00:00.000Z"
    );
    for (const at of [IN, IN, OUT])
      run(
        `INSERT INTO bus_messages (from_id, from_name, to_id, to_name, body, created_at)
         VALUES (?, 'orchestrator', ?, 'task', 'CI failed on PR #12 at 1a2b3c4d. Read the log.', ?)`,
        ID(1),
        ID(2),
        at
      );
    for (const [at, cost] of [
      [UNTIL - 1000, 1.25],
      [SINCE - 1000, 9],
    ])
      run(
        `INSERT INTO chat_turns (session_id, session_name, at, cost_usd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
         VALUES (?, 'o', ?, ?, 0, 0, 0, 0)`,
        ID(1),
        at,
        cost
      );
    run(
      `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count) VALUES (?, 'size', 'w', 2)`,
      ID(2)
    );
    run(
      `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count) VALUES ('not-audited', 'size', 'w', 5)`
    );

    const s = loadSignals(db(), SINCE, UNTIL, new Set([ID(1), ID(2)]));
    expect(s.checks).toHaveLength(2);
    expect(s.checks).toEqual(
      expect.arrayContaining([
        { kind: "review", status: "error", count: 1 },
        { kind: "review", status: "pass", count: 1 },
      ])
    );
    expect(s.reviewRounds).toEqual([
      { session: ID(2), reviews: 2, errors: 1, blocks: 0 },
    ]);
    expect(s.notes).toEqual([{ kind: "escalation", count: 1 }]);
    expect(s.events).toEqual([{ key: "ci", count: 1, hits: 2 }]);
    expect(s.idleEvents).toBe(1);
    expect(s.messages).toMatchObject({
      total: 2,
      fromOrchestrator: 2,
      toTasks: 2,
      top: [
        {
          text: "CI failed on PR #N at <sha>. Read the log.",
          count: 2,
          sessions: 1,
        },
      ],
    });
    expect(s.chatCostUsd).toBe(1.25);
    expect(s.gateFailures).toEqual([{ gate: "size", count: 2, sessions: 1 }]);
  });

  it("reads a database missing a table as none, and fails on a broken query", () => {
    const file = path.join(home, "old.db");
    const old = new Database(file);
    expect(loadSignals(old, SINCE, UNTIL, new Set()).checks).toEqual([]);
    old.exec("CREATE TABLE orchestrator_checks (unrelated TEXT)");
    expect(() => loadSignals(old, SINCE, UNTIL, new Set())).toThrow(
      /no such column/
    );
    old.close();
  });
});
