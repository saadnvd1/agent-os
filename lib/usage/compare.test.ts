import { describe, expect, it } from "vitest";
import { db } from "../db";
import { DEFAULT_PRICES } from "../models/providers";
import { seedSession, seedWorkspace } from "../orchestrator/testing";
import { spendByModel } from "./by-model";
import { estimateCost, planShares } from "./cost";
import { recordCheckRun } from "./check-runs";
import {
  LEDGER_SQL,
  compareRuns,
  taskOutcomes,
  type CompareTurn,
  type TaskOutcome,
} from "./compare";

const T0 = Date.UTC(2026, 9, 1);
let n = 0;
function turn(o: Partial<CompareTurn>): CompareTurn {
  return {
    session_id: "a",
    at: T0 + ++n * 1000,
    cost_usd: 0,
    input_tokens: 1_000_000,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    model: "claude-sonnet-5-5",
    provider: "anthropic",
    role: "implement",
    duration_ms: 60_000,
    window_pct: null,
    ...o,
  };
}

const outcome = (id: string, o: Partial<TaskOutcome> = {}): TaskOutcome => ({
  id,
  status: "merged",
  ciFirstGreen: null,
  reviewFirstPass: null,
  gateFailures: 0,
  rework: 0,
  ...o,
});

describe("cost estimates", () => {
  it("prices each kind of token from the table, aliases included", () => {
    const row = {
      provider: "anthropic",
      model: "opus",
      cost_usd: 9,
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_tokens: 1_000_000,
      cache_write_tokens: 1_000_000,
    };
    // Opus 5.5: 4 + 20 + 0.2 + 5.
    expect(estimateCost(row, DEFAULT_PRICES)).toEqual({
      usd: 29.2,
      priced: true,
    });
    // Before routing, a turn has no model: the agent's own figure stands.
    expect(
      estimateCost({ ...row, model: null, provider: null }, DEFAULT_PRICES)
    ).toEqual({
      usd: 9,
      priced: false,
    });
  });

  it("shares the plan's window out by how far each Claude turn moved it", () => {
    const shares = planShares([
      { at: 1, provider: null, window_pct: 10 },
      { at: 2, provider: "anthropic", window_pct: 14 },
      { at: 3, provider: "deepseek", window_pct: 99 },
      { at: 4, provider: "anthropic", window_pct: null },
      { at: 5, provider: "anthropic", window_pct: 20 },
      // The window reset: all of the new reading is this turn's.
      { at: 6, provider: "anthropic", window_pct: 3 },
    ]);
    expect(shares).toEqual([0, 4, 0, 0, 6, 3]);
  });

  it("sums spend by model and by role, with totals that agree", () => {
    const rows = [
      turn({ role: "plan", model: "claude-opus-5-5" }),
      turn({ role: "implement" }),
      turn({ role: "review", provider: "zai", model: "glm-5.3" }),
      turn({ at: T0 - 1, role: "implement" }),
    ];
    const s = spendByModel(rows, T0, DEFAULT_PRICES);
    expect(s.total.turns).toBe(3);
    expect(s.total.costUsd).toBeCloseTo(4 + 2 + 1.4);
    expect(s.models.map((m) => `${m.provider}/${m.model}`)).toEqual([
      "anthropic/claude-opus-5-5",
      "anthropic/claude-sonnet-5-5",
      "zai/glm-5.3",
    ]);
    expect(s.roles.map((r) => r.role)).toEqual(["plan", "implement", "review"]);
    const sum = (xs: { costUsd: number }[]) =>
      xs.reduce((a, x) => a + x.costUsd, 0);
    expect(sum(s.models)).toBeCloseTo(s.total.costUsd);
    expect(sum(s.roles)).toBeCloseTo(s.total.costUsd);
  });
});

describe("the comparison", () => {
  it("puts Claude-only tasks in the baseline and routed ones beside it", () => {
    const turns = [
      turn({ session_id: "a", window_pct: 10 }),
      turn({ session_id: "a", window_pct: 16 }),
      // Its review ran elsewhere: it counts toward its cost, not its cohort.
      turn({
        session_id: "a",
        role: "review",
        provider: "zai",
        model: "glm-5.3",
      }),
      turn({ session_id: "b", provider: "deepseek", model: "deepseek-v4-pro" }),
      turn({
        session_id: "c",
        model: null,
        provider: null,
        role: null,
        cost_usd: 3,
      }),
      // An interactive chat: in the role table, in no cohort.
      turn({ session_id: "chat", role: "interactive", model: "opus" }),
    ];
    const outcomes = new Map([
      [
        "a",
        outcome("a", {
          ciFirstGreen: true,
          reviewFirstPass: false,
          gateFailures: 1,
          rework: 2,
        }),
      ],
      [
        "b",
        outcome("b", {
          status: "dropped",
          ciFirstGreen: false,
          reviewFirstPass: true,
        }),
      ],
      ["c", outcome("c", { status: "running" })],
    ]);
    const cmp = compareRuns(turns, outcomes, DEFAULT_PRICES, {
      from: T0,
      to: T0 + 1e9,
    });
    expect(cmp.cohorts.map((c) => [c.key, c.tasks, c.baseline])).toEqual([
      ["anthropic", 2, true],
      ["deepseek", 1, false],
    ]);
    const [base, routed] = cmp.cohorts;
    expect(base.smallSample).toBe(true);
    expect(base.spend.turns).toBe(4);
    // Two Sonnet million-input turns, a GLM review, and an unpriced old turn.
    expect(base.spend.costUsd).toBeCloseTo(2 + 2 + 1.4 + 3);
    expect(base.planPct).toBe(6);
    expect(base.wallMs).toBe(4 * 60_000);
    expect(base.ciFirstGreen).toEqual({ yes: 1, of: 1 });
    expect(base.reviewFirstPass).toEqual({ yes: 0, of: 1 });
    expect(base.gateFailures).toBe(1);
    expect(base.rework).toBe(2);
    // Still running: neither merged nor dropped.
    expect(base.merged).toEqual({ yes: 1, of: 1 });
    expect(routed.spend.costUsd).toBeCloseTo(1.32);
    expect(routed.dropped).toEqual({ yes: 1, of: 1 });
    expect(routed.merged).toEqual({ yes: 0, of: 1 });

    const roleKeys = cmp.roles.map((r) => `${r.role} ${r.provider}/${r.model}`);
    expect(roleKeys).toEqual([
      "implement anthropic/claude-sonnet-5-5",
      "implement deepseek/deepseek-v4-pro",
      "interactive anthropic/claude-opus-5-5",
      "review zai/glm-5.3",
      "unrecorded anthropic/unrecorded",
    ]);
    const roleCost = cmp.roles.reduce((a, r) => a + r.costUsd, 0);
    const cohortCost = cmp.cohorts.reduce((a, c) => a + c.spend.costUsd, 0);
    // Everything in a cohort is in the role table too, plus the chat.
    expect(roleCost).toBeCloseTo(cohortCost + 4);
  });

  it("calls a cohort of ten or more tasks a sample", () => {
    const turns = Array.from({ length: 10 }, (_, i) =>
      turn({ session_id: `t${i}` })
    );
    const outcomes = new Map(
      turns.map((t) => [t.session_id, outcome(t.session_id)])
    );
    const [c] = compareRuns(turns, outcomes, DEFAULT_PRICES, {
      from: T0,
      to: T0 + 1e9,
    }).cohorts;
    expect(c.smallSample).toBe(false);
  });

  it("reads outcomes from the orchestrator's checks", () => {
    const { workspace, app } = seedWorkspace();
    const id = seedSession({ projectId: app.id, name: "t", task: true });
    const check = db.prepare(
      `INSERT INTO orchestrator_checks (workspace_id, session_id, sha, kind, status) VALUES (?, ?, ?, ?, ?)`
    );
    // One row per head and kind, updated in place (lib/orchestrator/checks).
    check.run(workspace.id, id, "s1", "ci", "pass");
    check.run(workspace.id, id, "s1", "review", "block");
    check.run(workspace.id, id, "s2", "ci", "running");
    check.run(workspace.id, id, "s2", "review", "pass");
    check.run(workspace.id, id, "s3", "ci", "block");
    db.prepare(
      `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count) VALUES (?, 'review', ?, 2)`
    ).run(id, workspace.id);
    expect(taskOutcomes([id, "not-a-task"]).get(id)).toEqual({
      id,
      status: "running",
      ciFirstGreen: true,
      reviewFirstPass: false,
      gateFailures: 2,
      rework: 2,
    });
  });

  it("counts the gate's own runs as review and scope turns, with their provider", () => {
    const { workspace, app } = seedWorkspace();
    const id = seedSession({ projectId: app.id, name: "gated", task: true });
    const at = Date.now();
    recordCheckRun(
      {
        workspaceId: workspace.id,
        sessionId: id,
        label: "task gated",
        prNumber: 7,
        sha: "abc",
        kind: "review",
      },
      {
        model: "glm-5.3",
        provider: "zai",
        inputTokens: 10,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 5,
        costUsd: 0.01,
        durationMs: 900,
      },
      at
    );
    const rows = db
      .prepare(LEDGER_SQL)
      .all({ from: at - 1, to: at + 1 }) as CompareTurn[];
    expect(rows.filter((r) => r.session_id === id)).toEqual([
      expect.objectContaining({
        role: "review",
        provider: "zai",
        model: "glm-5.3",
        duration_ms: 900,
        window_pct: null,
      }),
    ]);
  });
});
