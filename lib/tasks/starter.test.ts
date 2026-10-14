import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { isFork } from "@/lib/sessions/fork";
import {
  seedOrchestrator,
  seedSession,
  seedWorkspace,
} from "@/lib/orchestrator/testing";
import { orchestratorOf, recordStart } from "./starter";

describe("orchestratorOf", () => {
  it("follows started_by up to an orchestrator, and to nothing for a person's chain", () => {
    const { app } = seedWorkspace();
    seedOrchestrator("orch-chain");
    const a = seedSession({ projectId: app.id, name: "a", task: true });
    const b = seedSession({ projectId: app.id, name: "b", task: true });
    const c = seedSession({ projectId: app.id, name: "c", task: true });
    recordStart(a, {
      startedBy: "orch-chain",
      parentSessionId: "orch-chain",
      startedVia: "orchestrator",
    });
    recordStart(b, { startedBy: a, parentSessionId: a, startedVia: "session" });
    recordStart(c, {
      startedBy: null,
      parentSessionId: null,
      startedVia: "person",
    });
    expect(orchestratorOf(b)).toBe("orch-chain");
    expect(orchestratorOf(c)).toBeNull();
    expect(orchestratorOf(null)).toBeNull();
    expect(orchestratorOf(randomUUID())).toBeNull();
  });

  it("stops on a cycle", () => {
    const { app } = seedWorkspace();
    const a = seedSession({ projectId: app.id, name: "a", task: true });
    const b = seedSession({ projectId: app.id, name: "b", task: true });
    recordStart(a, { startedBy: b, parentSessionId: b, startedVia: "session" });
    recordStart(b, { startedBy: a, parentSessionId: a, startedVia: "session" });
    expect(orchestratorOf(a)).toBeNull();
  });

  it("recordStart drops a parent that no longer exists instead of failing", () => {
    const { app } = seedWorkspace();
    const a = seedSession({ projectId: app.id, name: "a", task: true });
    recordStart(a, {
      startedBy: null,
      parentSessionId: "gone",
      startedVia: "plan",
    });
    expect(
      db
        .prepare(
          `SELECT parent_session_id, started_via FROM sessions WHERE id = ?`
        )
        .get(a)
    ).toEqual({ parent_session_id: null, started_via: "plan" });
  });
});

describe("isFork", () => {
  it("a fork has a parent and no starter; a started task or session doesn't count", () => {
    expect(isFork({ parent_session_id: "p" })).toBe(true);
    expect(isFork({})).toBe(false);
    expect(
      isFork({
        parent_session_id: "p",
        started_by: "o",
        started_via: "orchestrator",
      })
    ).toBe(false);
    expect(isFork({ parent_session_id: "p", started_via: "plan" })).toBe(false);
    expect(isFork({ parent_session_id: "p", task_prompt: "x" })).toBe(false);
  });
});
