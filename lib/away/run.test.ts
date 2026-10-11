import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { ensureOrchestrator } from "../orchestrator/home";
import { setPaused } from "../orchestrator/pause";
import type { SessionFacts } from "../orchestrator/facts";
import type { DeployVerdict } from "./deploy";
import { fromSql, getAway, startAway, toSql, type AwayRow } from "./state";
import { STALL_MS } from "./sweep";
import { sweepWorkspace } from "./run";

// What the sweep reads and does, stood in for: the facts it's given, the
// git status it reads, the deploy verdict, and the messages it sends.
const h = vi.hoisted(() => ({
  facts: [] as SessionFacts[],
  dirty: new Set<string>(),
  verdict: { state: "pending" } as DeployVerdict,
  sent: [] as { to: string; body: string }[],
  reviewed: [] as string[],
  gitDirs: [] as string[],
  deployInputs: [] as { mergeSha: string | null; mergedAt: number }[],
  // Runs as the sweep reads its facts: something changing mid-sweep.
  meanwhile: null as null | (() => void),
}));

vi.mock("../orchestrator/facts", () => ({
  sessionFacts: async () => {
    h.meanwhile?.();
    return h.facts;
  },
}));
vi.mock("../bus", () => ({
  sendMessage: async (o: { to: string; body: string }) => {
    h.sent.push({ to: o.to, body: o.body });
    return {};
  },
}));
vi.mock("../orchestrator/review", () => ({
  review: async (_w: string, id: string) => {
    h.reviewed.push(id);
    return "started";
  },
}));
vi.mock("../tasks/gh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tasks/gh")>()),
  run: async (cmd: string, args: string[], cwd: string) => {
    if (cmd === "git" && args[0] === "status") {
      h.gitDirs.push(cwd);
      return [...h.dirty].some((id) => cwd.includes(id)) ? " M a.ts\n" : "";
    }
    if (cmd === "gh") return `${"a".repeat(40)}\n`;
    return "";
  },
}));
vi.mock("./deploy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deploy")>()),
  checkDeploy: async (i: { mergeSha: string | null; mergedAt: number }) => {
    h.deployInputs.push({ mergeSha: i.mergeSha, mergedAt: i.mergedAt });
    return h.verdict;
  },
}));
vi.mock("../notify", () => ({ notifyPhone: () => {} }));
// Every project deploys, so the merge commit is looked up.
vi.mock("../project-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../project-config")>()),
  loadProjectConfig: () => ({
    config: { deploy: { deployed: "~/deployed" } },
    source: "agentos.json",
    error: null,
  }),
}));

const NOW = Date.now();
let away: AwayRow;

beforeEach(() => {
  db.exec(
    `UPDATE away_periods SET ended_at = datetime('now'), ended_by = 'saad' WHERE ended_at IS NULL`
  );
  away = startAway({ setBy: "x", expiresAt: null }, NOW - 60 * 60 * 1000).row;
  h.facts = [];
  h.dirty = new Set();
  h.verdict = { state: "pending" };
  h.sent = [];
  h.reviewed = [];
  h.gitDirs = [];
  h.deployInputs = [];
  h.meanwhile = null;
});

// A task gone quiet past the stall time, with no PR.
const stalled = (id: string): SessionFacts => ({
  id,
  name: `task-${id.slice(0, 4)}`,
  project: "api",
  view: "terminal",
  status: "idle",
  activity: null,
  needsInput: false,
  lastActive: NOW - STALL_MS - 60_000,
  branch: "feature/x",
  task: { state: "review", pr: null, blocked: null },
  stack: null,
});

function seed() {
  const s = seedWorkspace();
  const orch = ensureOrchestrator(s.workspace.id);
  return { ...s, w: s.workspace.id, orch: orch.id };
}

const actions = (w: string) =>
  db
    .prepare(
      `SELECT kind, subject, key FROM away_actions WHERE away_id = ? AND workspace_id = ? ORDER BY id`
    )
    .all(away.id, w) as { kind: string; subject: string; key: string }[];

describe("sweeping a workspace while away", () => {
  it("nudges a stalled task from its orchestrator, and logs it", async () => {
    const { w, task, orch } = seed();
    h.facts = [stalled(task)];
    await sweepWorkspace(away, w, orch, NOW);
    expect(h.sent).toEqual([
      { to: task, body: expect.stringMatching(/^Saad is away/) },
    ]);
    expect(actions(w).map((a) => a.kind)).toEqual(["nudge"]);
    const note = db
      .prepare(
        `SELECT text FROM orchestrator_notes WHERE workspace_id = ? AND kind = 'away' ORDER BY id DESC LIMIT 1`
      )
      .get(w) as { text: string };
    expect(note.text).toMatch(/^Away sweep: task .*nudged it\.$/);
    // The next sweep: already done for this quiet spell.
    await sweepWorkspace(getAway(away.id)!, w, orch, NOW + 60_000);
    expect(h.sent).toHaveLength(1);
  });

  it("leaves a task with an open ask on it, or one escalated, to Saad", async () => {
    const { w, task, orch, api } = seed();
    const other = seedSession({ projectId: api.id, name: "other", task: true });
    db.prepare(
      `INSERT INTO orchestrator_asks (workspace_id, subject, kind, title, status) VALUES (?, ?, 'money', 'Pay for it?', 'open')`
    ).run(w, `task:${task}`);
    db.prepare(
      `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count, escalated_at) VALUES (?, 'review', ?, 2, datetime('now'))`
    ).run(other, w);
    h.facts = [stalled(task), stalled(other)];
    await sweepWorkspace(away, w, orch, NOW);
    expect(h.sent).toEqual([]);
    expect(actions(w)).toEqual([]);
  });

  it("does nothing in a paused workspace, or once Away is off", async () => {
    const { w, task, orch } = seed();
    h.facts = [stalled(task)];
    setPaused(w, true);
    await sweepWorkspace(away, w, orch, NOW);
    expect(h.sent).toEqual([]);
    setPaused(w, false);
    db.prepare(
      `UPDATE away_periods SET ended_at = datetime('now') WHERE id = ?`
    ).run(away.id);
    // A sweep that started before he came back still holds the old row.
    await sweepWorkspace(away, w, orch, NOW);
    expect(h.sent).toEqual([]);
    expect(actions(w)).toEqual([]);
  });

  it("stops acting when Saad pauses the workspace during a sweep", async () => {
    const { w, task, orch } = seed();
    h.facts = [stalled(task)];
    h.meanwhile = () => setPaused(w, true);
    await sweepWorkspace(away, w, orch, NOW);
    expect(h.sent).toEqual([]);
    expect(actions(w)).toEqual([]);
    setPaused(w, false);
  });

  it("reads git only on this machine, and asks a dirty idle task to commit", async () => {
    const { w, task, orch, api } = seed();
    const remote = seedSession({
      projectId: api.id,
      name: "remote",
      task: true,
    });
    db.prepare(`UPDATE sessions SET host_id = 'peer-1' WHERE id = ?`).run(
      remote
    );
    db.prepare(`UPDATE sessions SET worktree_path = ? WHERE id = ?`).run(
      `/tmp/wt-${task}`,
      task
    );
    h.dirty = new Set([task, remote]);
    h.facts = [stalled(task), stalled(remote)];
    await sweepWorkspace(away, w, orch, NOW);
    expect(h.gitDirs).toEqual([`/tmp/wt-${task}`]);
    const sent = Object.fromEntries(h.sent.map((m) => [m.to, m.body]));
    expect(sent[task]).toMatch(/Commit it and open a pull request/);
    // The linked machine's task is nudged, not asked about files it can't see.
    expect(sent[remote]).toMatch(/hasn't seen activity/);
  });
});

describe("checking deploys after a merge while away", () => {
  function merged(w: string, projectId: string) {
    const id = seedSession({ projectId, name: "shipped", task: true });
    db.prepare(`UPDATE sessions SET pr_number = 7 WHERE id = ?`).run(id);
    db.prepare(`UPDATE sessions SET task_status = 'merged' WHERE id = ?`).run(
      id
    );
    return id;
  }
  const events = (w: string) =>
    (
      db
        .prepare(`SELECT key FROM orchestrator_events WHERE workspace_id = ?`)
        .all(w) as { key: string }[]
    ).map((e) => e.key);

  it("keeps checking while pending, and records a failure once, as an event", async () => {
    const { w, orch, api } = seed();
    const id = merged(w, api.id);
    await sweepWorkspace(away, w, orch, NOW);
    expect(actions(w)).toEqual([]);
    h.verdict = { state: "failed", detail: "not deployed" };
    await sweepWorkspace(away, w, orch, NOW);
    expect(actions(w)).toEqual([
      { kind: "deploy_failed", subject: id, key: `deploy:${id}` },
    ]);
    expect(events(w)).toContain(`once:deploy:${id}`);
    h.verdict = { state: "ok", detail: "deployed" };
    await sweepWorkspace(away, w, orch, NOW);
    expect(actions(w)).toHaveLength(1);
  });

  it("checks with the merge commit and merge time, and skips what merged before Away", async () => {
    const { w, orch, api } = seed();
    const id = merged(w, api.id);
    const before = seedSession({ projectId: api.id, name: "old", task: true });
    db.prepare(
      `UPDATE sessions SET task_status = 'merged', pr_number = 6, merged_at = ? WHERE id = ?`
    ).run(toSql(NOW - 2 * 60 * 60 * 1000), before);
    await sweepWorkspace(away, w, orch, NOW);
    const at = db
      .prepare(`SELECT merged_at FROM sessions WHERE id = ?`)
      .get(id) as { merged_at: string };
    expect(h.deployInputs).toEqual([
      { mergeSha: "a".repeat(40), mergedAt: fromSql(at.merged_at) },
    ]);
  });

  it("records an unchecked project once, with no event", async () => {
    const { w, orch, api } = seed();
    const id = merged(w, api.id);
    h.verdict = { state: "unchecked", detail: "no deploy check configured" };
    await sweepWorkspace(away, w, orch, NOW);
    await sweepWorkspace(away, w, orch, NOW);
    expect(actions(w)).toEqual([
      { kind: "deploy_unchecked", subject: id, key: `deploy:${id}` },
    ]);
    expect(events(w)).not.toContain(`once:deploy:${id}`);
  });
});
