import { describe, expect, it, vi } from "vitest";
import { createWorkspace } from "@/lib/workspaces";
import type { TaskPR } from "@/lib/tasks/state";
import { conditionsFor, IDLE_NO_PR_MS, type StackFacts } from "./conditions";
import { recordConditions, pendingEvents } from "./events";
import { BATCH_WINDOW_MS, deliverEvents } from "./deliver";
import type { SessionFacts } from "./facts";
import { createProject } from "@/lib/projects";
import { seedSession } from "./testing";

const NOW = Date.parse("2026-10-06T12:00:00Z");
// Events about sessions that are gone are forgotten, so they're about a
// real one.
const SID = seedSession({
  projectId: createProject({ name: "api", workingDirectory: "/tmp/api" }).id,
  name: "add-auth",
});

const facts = (over: Partial<SessionFacts> = {}): SessionFacts => ({
  id: SID,
  name: "add-auth",
  project: "api",
  view: "terminal",
  status: "running",
  activity: null,
  lastActive: NOW,
  branch: "feature/add-auth",
  task: { state: "working", pr: null, blocked: null },
  stack: null,
  ...over,
});
const pr = (over: Partial<TaskPR> = {}): TaskPR => ({
  number: 12,
  url: "u",
  state: "OPEN",
  checks: "pending",
  head: "aaa",
  ...over,
});
const withTask = (task: Partial<NonNullable<SessionFacts["task"]>>) =>
  facts({ task: { state: "review", pr: null, blocked: null, ...task } });
const lines = (f: SessionFacts[], stacks: StackFacts[] = []) =>
  conditionsFor(f, stacks, NOW).map((c) => c.line);

describe("conditionsFor", () => {
  it("reads PRs, CI, merges and BLOCKED: lines as task events", () => {
    expect(lines([withTask({ pr: pr() })])).toEqual([
      "task add-auth: PR #12 opened (CI pending)",
    ]);
    expect(lines([withTask({ pr: pr({ checks: "pass" }) })])).toContain(
      "task add-auth: CI green"
    );
    expect(
      lines([withTask({ pr: pr({ checks: "fail", failing: "lint" }) })])
    ).toContain("task add-auth: CI failed: lint");
    expect(lines([withTask({ pr: pr({ state: "MERGED" }) })])).toEqual([
      "task add-auth: merged",
    ]);
    expect(
      lines([withTask({ state: "blocked", blocked: "need the key" })])
    ).toContain("task add-auth: BLOCKED: need the key");
  });

  it("reads needs-input and idle-with-no-PR as session events", () => {
    expect(
      lines([facts({ task: null, status: "waiting", activity: "Allow Bash?" })])
    ).toEqual(["add-auth: needs input: Allow Bash?"]);
    const idle = facts({
      status: "idle",
      lastActive: NOW - IDLE_NO_PR_MS - 60000,
    });
    expect(lines([idle])).toEqual(["task add-auth: idle 31m, no PR"]);
    // Not before 30 minutes, not with a PR, not for a session with no branch.
    expect(lines([facts({ status: "idle", lastActive: NOW - 60000 })])).toEqual(
      []
    );
    expect(
      lines([
        facts({ task: null, branch: null, status: "idle", lastActive: 0 }),
      ])
    ).toEqual([]);
  });

  it("reads stack steps", () => {
    const stack: StackFacts = {
      id: "st",
      name: "Auth",
      status: "running",
      items: [
        { id: "i1", ticket: "ROA-1", title: "a", status: "pr", error: null },
        {
          id: "i2",
          ticket: "ROA-2",
          title: "b",
          status: "planned",
          error: null,
        },
        {
          id: "i3",
          ticket: null,
          title: "c",
          status: "failed",
          error: "conflict",
        },
      ],
    };
    expect(lines([], [stack])).toEqual([
      "stack Auth: ROA-1 PR up",
      "stack Auth: c failed: conflict",
    ]);
  });
});

describe("recordConditions", () => {
  it("takes the first look as known, then queues only what's new", async () => {
    const w = createWorkspace("Diff");
    const open = conditionsFor([withTask({ pr: pr() })], [], NOW);
    expect(recordConditions(w.id, open, NOW)).toEqual([]);
    expect(pendingEvents(w.id)).toEqual([]);

    const green = conditionsFor(
      [withTask({ pr: pr({ checks: "pass" }) })],
      [],
      NOW
    );
    expect(recordConditions(w.id, green, NOW)).toEqual([
      "task add-auth: CI green",
    ]);
    // Seen again on the next poll, and again after a restart (the store is
    // the database, so a fresh diff reads the same keys): folded.
    expect(recordConditions(w.id, green, NOW)).toEqual([]);
    vi.resetModules();
    const restarted = await import("./events");
    expect(restarted.recordConditions(w.id, green, NOW)).toEqual([]);
    expect(restarted.pendingEvents(w.id).map((e) => e.line)).toEqual([
      "task add-auth: CI green",
    ]);
  });

  it("sends a needs-input again only after it has cleared", () => {
    const w = createWorkspace("Again");
    recordConditions(w.id, [], NOW);
    const waiting = conditionsFor(
      [facts({ task: null, status: "waiting", activity: "Allow?" })],
      [],
      NOW
    );
    expect(recordConditions(w.id, waiting, NOW)).toHaveLength(1);
    expect(recordConditions(w.id, waiting, NOW)).toHaveLength(0);
    expect(recordConditions(w.id, [], NOW)).toHaveLength(0);
    expect(recordConditions(w.id, waiting, NOW)).toHaveLength(1);
  });
});

describe("deliverEvents", () => {
  const setup = (name: string) => {
    const w = createWorkspace(name);
    recordConditions(w.id, [], NOW);
    const sent: string[] = [];
    const send = async (_id: string, input: { text: string; from: string }) => {
      expect(input.from).toBe("agentos");
      sent.push(input.text);
    };
    const queue = (key: string, line: string) =>
      recordConditions(
        w.id,
        [
          ...pendingEvents(w.id).map((e) => ({
            key: e.key,
            subject: SID,
            line: e.line,
            sticky: true,
          })),
          { key, subject: SID, line, sticky: true },
        ],
        NOW
      );
    const deliver = (now: number, turn: "idle" | "running" | null = null) =>
      deliverEvents({
        workspaceId: w.id,
        orchestratorId: "o",
        turn,
        send,
        now,
      });
    return { sent, queue, deliver };
  };

  it("joins what's queued into one message, at most once per window", async () => {
    const { sent, queue, deliver } = setup("Batch");
    queue("a", "task a: PR #1 opened (CI pending)");
    queue("b", "task b: CI green");
    await deliver(NOW);
    expect(sent).toEqual([
      "task a: PR #1 opened (CI pending)\ntask b: CI green",
    ]);

    queue("c", "task c: merged");
    queue("d", "stack S: ROA-1 PR up");
    await deliver(NOW + BATCH_WINDOW_MS - 1000);
    expect(sent).toHaveLength(1);
    await deliver(NOW + BATCH_WINDOW_MS);
    expect(sent[1]).toBe("task c: merged\nstack S: ROA-1 PR up");
    await deliver(NOW + 10 * BATCH_WINDOW_MS);
    expect(sent).toHaveLength(2);
  });

  it("holds events while the orchestrator's turn runs", async () => {
    const { sent, queue, deliver } = setup("Busy");
    queue("a", "task a: merged");
    await deliver(NOW, "running");
    expect(sent).toEqual([]);
    await deliver(NOW + 1000, "idle");
    expect(sent).toEqual(["task a: merged"]);
  });

  it("puts events back when sending fails", async () => {
    const w = createWorkspace("Fails");
    recordConditions(w.id, [], NOW);
    recordConditions(
      w.id,
      [{ key: "k", subject: SID, line: "task k: merged", sticky: true }],
      NOW
    );
    const send = async () => {
      throw new Error("worker down");
    };
    await expect(
      deliverEvents({
        workspaceId: w.id,
        orchestratorId: "o",
        turn: null,
        send,
        now: NOW,
      })
    ).rejects.toThrow("worker down");
    expect(pendingEvents(w.id).map((e) => e.line)).toEqual(["task k: merged"]);
  });
});
