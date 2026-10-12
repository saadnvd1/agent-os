import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { ensureOrchestrator } from "../orchestrator/home";
import { setPaused } from "../orchestrator/pause";
import type { SessionFacts } from "../orchestrator/facts";
import type { DeployVerdict } from "./deploy";
import { fromSql, getAway, startAway, toSql, type AwayRow } from "./state";
import { IDLE_DIRTY_MS, STALL_MS } from "./sweep";
import { awayDigestLine } from "./brief";
import { sweepWorkspace, turnAwayOff, turnAwayOn } from "./run";

// What the sweep reads and does, stood in for: the facts it's given, the
// git status it reads, the deploy verdict, and the messages it sends.
const h = vi.hoisted(() => ({
  facts: [] as SessionFacts[],
  dirty: new Set<string>(),
  verdict: { state: "pending" } as DeployVerdict,
  reviewed: [] as string[],
  gitDirs: [] as string[],
  deployInputs: [] as { mergeSha: string | null; mergedAt: number }[],
  // Runs as the sweep reads its facts: something changing mid-sweep.
  meanwhile: null as null | (() => void),
  // Real turns by session (else its facts' lastActive), and sessions
  // whose agent is down.
  turns: new Map<string, number>(),
  down: new Set<string>(),
}));

vi.mock("../orchestrator/facts", () => ({
  sessionFacts: async () => {
    h.meanwhile?.();
    return h.facts;
  },
}));
vi.mock("../orchestrator/review", () => ({
  review: async (_w: string, id: string) => {
    h.reviewed.push(id);
    return "started";
  },
}));
vi.mock("../git-exec", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../git-exec")>()),
  git: async (cwd: string, args: string[]) => {
    if (args[0] === "status") {
      h.gitDirs.push(cwd);
      return [...h.dirty].some((id) => cwd.includes(id)) ? " M a.ts\n" : "";
    }
    return "";
  },
}));
vi.mock("../tasks/gh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tasks/gh")>()),
  run: async (cmd: string) => (cmd === "gh" ? `${"a".repeat(40)}\n` : ""),
}));
vi.mock("./deploy", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deploy")>()),
  checkDeploy: async (i: { mergeSha: string | null; mergedAt: number }) => {
    h.deployInputs.push({ mergeSha: i.mergeSha, mergedAt: i.mergedAt });
    return h.verdict;
  },
}));
vi.mock("../notify", () => ({ notifyPhone: () => {} }));
vi.mock("./activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./activity")>()),
  lastTurnAt: (s: { id: string }) =>
    h.turns.get(s.id) ?? h.facts.find((f) => f.id === s.id)?.lastActive ?? 0,
  agentLive: (s: { id: string }) => !h.down.has(s.id),
}));
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
  h.reviewed = [];
  h.gitDirs = [];
  h.deployInputs = [];
  h.meanwhile = null;
  h.turns = new Map();
  h.down = new Set();
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

// One chat item in a session; no origin means Saad typed it.
let seq = 0;
function chatItem(
  sessionId: string,
  at: number,
  origin?: { kind: string; label: string }
) {
  db.prepare(
    `INSERT INTO chat_items (session_id, item_id, seq, data) VALUES (?, ?, ?, ?)`
  ).run(
    sessionId,
    `i${++seq}`,
    seq,
    JSON.stringify({ kind: "user", createdAt: at, text: "hi", origin })
  );
}

// A workspace whose orchestrator worked, and was messaged by Saad, five
// minutes ago.
function seed() {
  const s = seedWorkspace();
  const orch = ensureOrchestrator(s.workspace.id);
  h.turns.set(orch.id, NOW - 5 * 60_000);
  chatItem(orch.id, NOW - 5 * 60_000);
  return { ...s, w: s.workspace.id, orch: orch.id };
}

// One-off events queued for the orchestrator (their keys and lines).
const events = (w: string) =>
  db
    .prepare(
      `SELECT key, line FROM orchestrator_events WHERE workspace_id = ? AND key LIKE 'once:%' ORDER BY id`
    )
    .all(w) as { key: string; line: string }[];
const digests = (w: string) =>
  events(w).filter((e) => e.key.startsWith("once:away-digest:"));

const actions = (w: string) =>
  db
    .prepare(
      `SELECT kind, subject, key FROM away_actions WHERE away_id = ? AND workspace_id = ? ORDER BY id`
    )
    .all(away.id, w) as { kind: string; subject: string; key: string }[];

describe("sweeping a workspace while away", () => {
  it("sends an active orchestrator one digest, and messages no session", async () => {
    const { w, task, orch, api } = seed();
    const other = seedSession({ projectId: api.id, name: "other", task: true });
    db.prepare(`UPDATE sessions SET worktree_path = ? WHERE id = ?`).run(
      `/tmp/wt-${other}`,
      other
    );
    h.dirty = new Set([other]);
    h.facts = [
      stalled(task),
      { ...stalled(other), lastActive: NOW - IDLE_DIRTY_MS },
    ];
    const digest = await sweepWorkspace(away, w, orch, NOW);
    expect(digests(w)).toHaveLength(1);
    expect(digest).toMatch(/^Away sweep:/);
    expect(digest).toContain(`- stalled: task ${stalled(task).name} (${task})`);
    expect(digest).toContain(
      `- uncommitted, no PR: task ${stalled(other).name} (${other})`
    );
    // It's told Saad is away first, once.
    expect(events(w).map((e) => e.key)).toEqual([
      `once:away:${away.id}`,
      expect.stringMatching(/^once:away-digest:/),
    ]);
    expect(actions(w).map((a) => a.kind)).toEqual([
      "told",
      "digest",
      "stalled",
      "commit",
    ]);
  });

  it("stops once the orchestrator has gone idle past the window", async () => {
    const { w, task, orch, api } = seed();
    h.facts = [stalled(task)];
    await sweepWorkspace(away, w, orch, NOW);
    const later = seedSession({ projectId: api.id, name: "later", task: true });
    h.facts = [stalled(task), stalled(later)];
    h.turns.set(orch, NOW - 2 * 60 * 60_000);
    expect(
      await sweepWorkspace(getAway(away.id)!, w, orch, NOW + 60_000)
    ).toBeNull();
    expect(digests(w)).toHaveLength(1);
  });

  it("sends each workspace its own digest in the same sweep", async () => {
    const a = seed();
    const b = seed();
    h.facts = [stalled(a.task)];
    await sweepWorkspace(away, a.w, a.orch, NOW);
    h.facts = [stalled(b.task)];
    await sweepWorkspace(away, b.w, b.orch, NOW);
    expect(digests(a.w)).toHaveLength(1);
    expect(digests(b.w)).toHaveLength(1);
  });

  it("sends no second digest when nothing changed", async () => {
    const { w, task, orch } = seed();
    h.facts = [stalled(task)];
    await sweepWorkspace(away, w, orch, NOW);
    const again = await sweepWorkspace(
      getAway(away.id)!,
      w,
      orch,
      NOW + 60_000
    );
    expect(again).toBeNull();
    expect(digests(w)).toHaveLength(1);
  });

  it("leaves a workspace whose orchestrator is idle past the window alone", async () => {
    const { w, task, orch } = seed();
    h.turns.set(orch, NOW - 2 * 60 * 60_000);
    h.facts = [stalled(task)];
    expect(await sweepWorkspace(away, w, orch, NOW)).toBeNull();
    expect(events(w)).toEqual([]);
    expect(actions(w)).toEqual([]);
    expect(h.reviewed).toEqual([]);
  });

  it("never lists an old idle session, a stopped one or one whose agent is down", async () => {
    const { w, orch, api } = seed();
    const old = seedSession({ projectId: api.id, name: "old" });
    const stopped = seedSession({ projectId: api.id, name: "stopped" });
    const down = seedSession({ projectId: api.id, name: "down" });
    const mine = (id: string, over: Partial<SessionFacts> = {}) => ({
      ...stalled(id),
      name: id.slice(0, 4),
      task: null,
      lastActive: NOW - IDLE_DIRTY_MS,
      ...over,
    });
    h.facts = [
      mine(old, { lastActive: NOW - 3 * 60 * 60_000 }),
      mine(stopped, { status: "dead" }),
      mine(down),
    ];
    h.down = new Set([down]);
    h.dirty = new Set([old, stopped, down]);
    expect(await sweepWorkspace(away, w, orch, NOW)).toBeNull();
    expect(h.gitDirs).toEqual([]);
    expect(digests(w)).toEqual([]);
  });

  it("lists a recent interactive session with uncommitted work once a period", async () => {
    const { w, orch, api } = seed();
    const mine = seedSession({ projectId: api.id, name: "mine" });
    db.prepare(`UPDATE sessions SET worktree_path = ? WHERE id = ?`).run(
      `/tmp/wt-${mine}`,
      mine
    );
    h.facts = [
      {
        ...stalled(mine),
        name: "mine",
        task: null,
        lastActive: NOW - IDLE_DIRTY_MS,
      },
    ];
    h.dirty = new Set([mine]);
    const digest = await sweepWorkspace(away, w, orch, NOW);
    expect(digest).toContain(`- interactive: mine (${mine})`);
    // A later sweep, even after it worked again: not listed a second time.
    h.facts = [{ ...h.facts[0], lastActive: NOW + 60_000 - IDLE_DIRTY_MS }];
    expect(
      await sweepWorkspace(getAway(away.id)!, w, orch, NOW + 60_000)
    ).toBeNull();
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
    expect(digests(w)).toEqual([]);
    expect(actions(w).map((a) => a.kind)).toEqual(["told"]);
  });

  it("does nothing in a paused workspace, or once Away is off", async () => {
    const { w, task, orch } = seed();
    h.facts = [stalled(task)];
    setPaused(w, true);
    await sweepWorkspace(away, w, orch, NOW);
    expect(events(w)).toEqual([]);
    setPaused(w, false);
    db.prepare(
      `UPDATE away_periods SET ended_at = datetime('now') WHERE id = ?`
    ).run(away.id);
    // A sweep that started before he came back still holds the old row.
    await sweepWorkspace(away, w, orch, NOW);
    expect(digests(w)).toEqual([]);
    expect(actions(w).filter((a) => a.kind !== "told")).toEqual([]);
  });

  it("stops acting when Saad pauses the workspace during a sweep", async () => {
    const { w, task, orch } = seed();
    h.facts = [stalled(task)];
    h.meanwhile = () => setPaused(w, true);
    await sweepWorkspace(away, w, orch, NOW);
    expect(digests(w)).toEqual([]);
    expect(actions(w).map((a) => a.kind)).toEqual(["told"]);
    setPaused(w, false);
  });

  it("reads git only on this machine", async () => {
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
    const digest = await sweepWorkspace(away, w, orch, NOW);
    expect(h.gitDirs).toEqual([`/tmp/wt-${task}`]);
    expect(digest).toContain(`uncommitted, no PR: task ${stalled(task).name}`);
    // The linked machine's task is listed as stalled, not for files it can't see.
    expect(digest).toContain(`stalled: task ${stalled(remote).name}`);
  });
});

describe("turning Away on and off", () => {
  it("tells only orchestrators active inside the window, and reports only those workspaces", () => {
    db.exec(
      `UPDATE away_periods SET ended_at = datetime('now'), ended_by = 'saad' WHERE ended_at IS NULL`
    );
    const busy = seed();
    const idle = seed();
    h.turns.set(idle.orch, NOW - 3 * 60 * 60_000);
    const row = turnAwayOn({ setBy: "x", expiresAt: null }, NOW);
    expect(events(busy.w).map((e) => e.key)).toEqual([`once:away:${row.id}`]);
    expect(events(idle.w)).toEqual([]);
    const ended = turnAwayOff("saad", NOW + 1000)!;
    expect(events(busy.w).map((e) => e.key)).toContain(
      `once:away-back:${row.id}`
    );
    expect(events(idle.w)).toEqual([]);
    const report = JSON.parse(ended.report!) as {
      workspaces: { id: string }[];
    };
    expect(report.workspaces.map((x) => x.id)).not.toContain(idle.w);
  });
});

describe("telling orchestrators Away is on", () => {
  it("messages only the one Saad wrote to inside 24 hours", async () => {
    db.exec(
      `UPDATE away_periods SET ended_at = datetime('now'), ended_by = 'saad' WHERE ended_at IS NULL`
    );
    const mk = () => {
      const s = seedWorkspace();
      const orch = ensureOrchestrator(s.workspace.id);
      h.turns.set(orch.id, NOW - 60_000);
      return { w: s.workspace.id, orch: orch.id };
    };
    const recent = mk();
    chatItem(recent.orch, NOW - 60 * 60_000);
    const old = mk();
    chatItem(old.orch, NOW - 3 * 24 * 60 * 60_000);
    const automated = mk();
    const decided = mk();
    chatItem(decided.orch, NOW - 60_000, { kind: "decision", label: "Saad" });
    for (const kind of ["event", "schedule", "peer", "system"])
      chatItem(automated.orch, NOW - 60_000, { kind, label: kind });

    const row = turnAwayOn({ setBy: "x", expiresAt: null }, NOW);
    expect(events(recent.w).map((e) => e.key)).toEqual([`once:away:${row.id}`]);
    expect(events(decided.w)).toHaveLength(1);
    expect(events(old.w)).toEqual([]);
    expect(events(automated.w)).toEqual([]);

    // The sweep doesn't tell the skipped ones either, but their brief
    // still says Saad is away.
    await sweepWorkspace(row, old.w, old.orch, NOW);
    await sweepWorkspace(row, automated.w, automated.orch, NOW);
    expect(events(old.w)).toEqual([]);
    expect(events(automated.w)).toEqual([]);
    expect(awayDigestLine(NOW)).toContain("Saad is away");

    turnAwayOff("saad", NOW + 1000);
    expect(events(recent.w).map((e) => e.key)).toContain(
      `once:away-back:${row.id}`
    );
    expect(events(old.w)).toEqual([]);
    expect(events(automated.w)).toEqual([]);
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
  it("keeps checking while pending, and records a failure once, in a digest", async () => {
    const { w, orch, api } = seed();
    const id = merged(w, api.id);
    await sweepWorkspace(away, w, orch, NOW);
    const deploys = () => actions(w).filter((a) => a.kind.startsWith("deploy"));
    expect(deploys()).toEqual([]);
    h.verdict = { state: "failed", detail: "not deployed" };
    await sweepWorkspace(away, w, orch, NOW + 1);
    expect(deploys()).toEqual([
      { kind: "deploy_failed", subject: id, key: `deploy:${id}` },
    ]);
    expect(digests(w).map((d) => d.line)).toEqual([
      expect.stringContaining(
        "- deploy: task shipped: PR #7 merged; deploy failed: not deployed"
      ),
    ]);
    h.verdict = { state: "ok", detail: "deployed" };
    await sweepWorkspace(away, w, orch, NOW + 2);
    expect(deploys()).toHaveLength(1);
    expect(digests(w)).toHaveLength(1);
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
    expect(actions(w).filter((a) => a.kind !== "told")).toEqual([
      { kind: "deploy_unchecked", subject: id, key: `deploy:${id}` },
    ]);
    expect(digests(w)).toEqual([]);
  });
});
