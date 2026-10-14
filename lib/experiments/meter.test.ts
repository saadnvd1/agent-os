import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import type { ClaudeRun } from "../orchestrator/claude-cli";
import type { RunUsage } from "../usage/check-runs";
import { setExperiment } from ".";
import {
  countEvent,
  experimentRun,
  hasEvent,
  usageDetail,
  usageSummary,
} from "./meter";

const ID = "learning-cards";
const run: ClaudeRun = {
  cwd: "/tmp",
  system: "s",
  prompt: "p",
  schema: {},
  tools: [],
};
const usage: RunUsage = {
  model: "claude-haiku-4-5-20251001",
  inputTokens: 1000,
  cacheWriteTokens: 200,
  cacheReadTokens: 300,
  outputTokens: 50,
  costUsd: 0.0123,
  durationMs: 2500,
};
const ctx = { trigger: "session-end", sessionId: "s1", workspaceId: "w1" };
const rows = () =>
  db.prepare(`SELECT * FROM experiment_usage ORDER BY id`).all() as Record<
    string,
    unknown
  >[];

beforeEach(() => {
  db.exec(`DELETE FROM experiment_usage; DELETE FROM usage_calls`);
  setExperiment(ID, false);
});

describe("an experiment that is off", () => {
  it("makes no model call and records nothing", async () => {
    const runner = vi.fn();
    expect(await experimentRun(ID, ctx, run, runner)).toBeNull();
    countEvent(ID, "script", ctx);
    expect(runner).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
  });

  it("still counts a decision on a card already shown, when forced", () => {
    countEvent(ID, "dismissed", ctx, true);
    expect(rows()).toHaveLength(1);
  });
});

describe("experimentRun", () => {
  beforeEach(() => setExperiment(ID, true));

  it("records the call's tokens, cost, duration and trigger, and mirrors it into the ledger", async () => {
    const runner = vi.fn(async (r: ClaudeRun) => {
      r.onUsage?.(usage);
      return { ok: true };
    });
    expect(await experimentRun(ID, ctx, run, runner)).toEqual({ ok: true });
    const [r] = rows();
    expect(r).toMatchObject({
      experiment_id: ID,
      event: "model",
      trigger: "session-end",
      session_id: "s1",
      workspace_id: "w1",
      model: "claude-haiku-4-5-20251001",
      provider: "anthropic",
      input_tokens: 1000,
      cache_write_tokens: 200,
      cache_read_tokens: 300,
      output_tokens: 50,
      cost_usd: 0.0123,
      duration_ms: 2500,
      ok: 1,
    });
    const call = db
      .prepare(`SELECT * FROM usage_calls WHERE call_key = ?`)
      .get(`experiment:${r.id}`) as Record<string, unknown>;
    expect(call).toMatchObject({
      kind: "helper",
      role: `experiment:${ID}`,
      input_tokens: 1000,
      output_tokens: 50,
    });
  });

  it("records a failed call's usage and an error row, then throws", async () => {
    const runner = async (r: ClaudeRun) => {
      r.onUsage?.(usage);
      throw new Error("no answer");
    };
    await expect(experimentRun(ID, ctx, run, runner)).rejects.toThrow(
      "no answer"
    );
    expect(rows().map((r) => [r.event, r.ok])).toEqual([
      ["model", 1],
      ["error", 0],
    ]);
  });
});

describe("usage totals", () => {
  const now = new Date(2026, 9, 13, 15).getTime();
  const DAY = 86_400_000;
  const put = (event: string, at: number, cost = 0, tokens = 0) =>
    db
      .prepare(
        `INSERT INTO experiment_usage (experiment_id, event, trigger, session_id, input_tokens, cost_usd, at)
         VALUES (?, ?, 'session-end', ?, ?, ?, ?)`
      )
      .run(ID, event, "s1", tokens, cost, at);

  it("splits today, 7 and 30 days, and computes the accept rate", () => {
    put("model", now - 1000, 0.1, 100);
    put("model", now - 3 * DAY, 0.2, 200);
    put("model", now - 20 * DAY, 0.4, 400);
    put("model", now - 40 * DAY, 9, 9);
    put("accepted", now - 1000);
    put("dismissed", now - 2000);
    put("accepted", now - 3 * DAY);
    put("shown", now - 1000);
    const u = usageSummary(ID, now);
    expect(u.today).toMatchObject({
      calls: 1,
      tokens: 100,
      accepted: 1,
      dismissed: 1,
      shown: 1,
      acceptRate: 0.5,
    });
    expect(u.d7).toMatchObject({
      calls: 2,
      tokens: 300,
      accepted: 2,
      acceptRate: 2 / 3,
    });
    expect(u.d30.calls).toBe(3);
    expect(u.d30.costUsd).toBeCloseTo(0.7);
  });

  it("has no accept rate before any decision", () => {
    put("script", now);
    expect(usageSummary(ID, now).today).toMatchObject({
      scripts: 1,
      acceptRate: null,
    });
  });

  it("gives 30 days, by trigger and model, and the latest events", () => {
    put("model", now, 0.1, 100);
    const d = usageDetail(ID, now);
    expect(d.days).toHaveLength(30);
    expect(d.days.at(-1)).toMatchObject({ calls: 1, tokens: 100 });
    expect(d.byTrigger[0]).toMatchObject({ key: "session-end", calls: 1 });
    expect(d.byModel[0].key).toBe("unrecorded");
    expect(d.recent).toHaveLength(1);
  });

  it("knows a session already has an event", () => {
    put("script", now);
    expect(hasEvent(ID, "s1", "script")).toBe(true);
    expect(hasEvent(ID, "s2", "script")).toBe(false);
  });
});
