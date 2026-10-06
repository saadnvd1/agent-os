import { describe, expect, it, vi } from "vitest";
import { createWorkspace } from "@/lib/workspaces";
import { createProject } from "@/lib/projects";
import type { Condition } from "./conditions";
import {
  markDelivered,
  pendingEvents,
  recordConditions,
  REFIRE_MS,
} from "./events";
import {
  backoffMs,
  BATCH_WINDOW_MS,
  deliverEvents,
  LOW_HOLD_MS,
  SUBJECT_CAP,
} from "./deliver";
import { NOW } from "./fixtures";
import { seedSession } from "./testing";

// Events about sessions that are gone are forgotten, so they're about real ones.
const project = createProject({ name: "api", workingDirectory: "/tmp/api" });
const sid = () => seedSession({ projectId: project.id, name: "add-auth" });

const cond = (
  subject: string,
  key: string,
  over: Partial<Condition> = {}
): Condition => ({
  key: `${key}:${subject}`,
  subject,
  line: `${key} ${subject.slice(0, 4)}`,
  sticky: true,
  ...over,
});

// A workspace whose sessions have been seen once with nothing going on.
function setup(subjects = [sid()]) {
  const w = createWorkspace(`w-${Math.random()}`);
  recordConditions(w.id, [], subjects, NOW);
  const record = (conds: Condition[], now = NOW) =>
    recordConditions(w.id, conds, subjects, now);
  const pending = () => pendingEvents(w.id).map((e) => e.line);
  const deliverAll = (at: number) =>
    markDelivered(
      pendingEvents(w.id).map((e) => e.id),
      at
    );
  return { w, subjects, record, pending, deliverAll };
}

describe("recordConditions", () => {
  it("takes a subject's first look as known state", () => {
    const s = sid();
    const w = createWorkspace("First");
    const open = [cond(s, "pr")];
    recordConditions(w.id, open, [s], NOW);
    recordConditions(w.id, open, [s], NOW);
    expect(pendingEvents(w.id)).toEqual([]);
    // A session that joins later is also first seen as it is.
    const later = sid();
    const both = [...open, cond(later, "needs")];
    recordConditions(w.id, both, [s, later], NOW);
    recordConditions(w.id, both, [s, later], NOW);
    expect(pendingEvents(w.id)).toEqual([]);
  });

  it("sends a condition only once it holds on two diffs in a row", () => {
    const { subjects, record, pending } = setup();
    const c = [cond(subjects[0], "ci")];
    expect(record(c)).toEqual([]);
    expect(pending()).toEqual([]);
    expect(record(c)).toEqual([c[0].line]);
    expect(pending()).toEqual([c[0].line]);
  });

  it("drops a flap that clears before it's sent", () => {
    const { subjects, record, pending } = setup();
    const c = [cond(subjects[0], "needs", { sticky: false })];
    record(c);
    record([]);
    record(c);
    expect(pending()).toEqual([]);
  });

  it("doesn't send a passing event again within 15 minutes", () => {
    const { subjects, record, pending, deliverAll } = setup();
    const c = [cond(subjects[0], "needs", { sticky: false })];
    record(c);
    record(c);
    deliverAll(NOW);
    record([], NOW + 60000);
    record(c, NOW + 120000);
    record(c, NOW + 125000);
    expect(pending()).toEqual([]);
    record([], NOW + 180000);
    record(c, NOW + REFIRE_MS + 1000);
    record(c, NOW + REFIRE_MS + 2000);
    expect(pending()).toEqual([c[0].line]);
  });

  it("resends nothing after a restart", async () => {
    const { w, subjects, record, deliverAll } = setup();
    const c = [cond(subjects[0], "merged")];
    record(c);
    record(c);
    deliverAll(NOW);
    vi.resetModules();
    const restarted = await import("./events");
    restarted.recordConditions(w.id, c, subjects, NOW + 5000);
    restarted.recordConditions(w.id, c, subjects, NOW + 10000);
    expect(restarted.pendingEvents(w.id)).toEqual([]);
  });
});

describe("deliverEvents", () => {
  function batch() {
    const s = setup([sid(), sid()]);
    const live: Condition[] = [];
    const sent: string[] = [];
    const add = (c: Condition) => {
      live.push(c);
      s.record(live);
      s.record(live);
    };
    const deliver = (
      now: number,
      turn: "idle" | "running" | null = null,
      fail = false
    ) =>
      deliverEvents({
        workspaceId: s.w.id,
        orchestratorId: "o",
        turn,
        now,
        send: async (_id, input) => {
          expect(input.from).toBe("agentos");
          if (fail) throw new Error("worker down");
          sent.push(input.text);
        },
      });
    return { ...s, add, sent, deliver };
  }

  it("joins what's ready into one message, at most once per window", async () => {
    const { subjects, add, sent, deliver } = batch();
    const [a, b] = subjects;
    add(cond(a, "pr"));
    add(cond(b, "ci"));
    await deliver(NOW);
    expect(sent).toEqual([`pr ${a.slice(0, 4)}\nci ${b.slice(0, 4)}`]);
    add(cond(a, "merged"));
    await deliver(NOW + BATCH_WINDOW_MS - 1000);
    expect(sent).toHaveLength(1);
    await deliver(NOW + BATCH_WINDOW_MS);
    expect(sent).toHaveLength(2);
  });

  it("holds events while the orchestrator's turn runs", async () => {
    const { subjects, add, sent, deliver } = batch();
    add(cond(subjects[0], "merged"));
    await deliver(NOW, "running");
    expect(sent).toEqual([]);
    await deliver(NOW + 1000, "idle");
    expect(sent).toHaveLength(1);
  });

  it("holds low-value events for a batch or 10 minutes", async () => {
    const { subjects, add, sent, deliver } = batch();
    const [a, b] = subjects;
    add(cond(a, "idle", { low: true, sticky: false }));
    await deliver(NOW + 1000);
    expect(sent).toEqual([]);
    await deliver(NOW + LOW_HOLD_MS + 1000);
    expect(sent).toHaveLength(1);
    add(cond(b, "idle", { low: true, sticky: false }));
    add(cond(a, "merged"));
    await deliver(NOW + LOW_HOLD_MS + BATCH_WINDOW_MS + 2000);
    expect(sent[1].split("\n")).toHaveLength(2);
  });

  it(`caps a subject at ${SUBJECT_CAP} events an hour`, async () => {
    const { subjects, add, sent, deliver } = batch();
    for (let i = 0; i < SUBJECT_CAP + 2; i++) {
      add(cond(subjects[0], `step${i}`));
      await deliver(NOW + i * BATCH_WINDOW_MS);
    }
    expect(sent).toHaveLength(SUBJECT_CAP);
  });

  it("puts events back and backs off when sending fails", async () => {
    const { subjects, add, sent, deliver, pending } = batch();
    add(cond(subjects[0], "merged"));
    await expect(deliver(NOW, null, true)).rejects.toThrow("worker down");
    expect(pending()).toEqual([`merged ${subjects[0].slice(0, 4)}`]);
    await deliver(NOW + backoffMs(1) - 1);
    expect(sent).toEqual([]);
    await deliver(NOW + backoffMs(1));
    expect(sent).toHaveLength(1);
    expect([1, 2, 3, 10].map(backoffMs)).toEqual([5000, 10000, 20000, 300000]);
  });
});
