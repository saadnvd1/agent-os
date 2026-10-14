import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { usageEvents } from "../chat/drivers/claude";
import {
  backfillCheckRuns,
  callFromAssistant,
  recordCall,
  sessionContext,
  taskCosts,
} from "./calls";
import { recordCheckRun } from "./check-runs";
import {
  currentWindow,
  estimateWeekly,
  lastReading,
  parseRateLimit,
  recordReadings,
  windowSamples,
} from "./rate-limits";

const k = (n: number) => n * 1000;

beforeEach(() => {
  db.exec(
    `DELETE FROM usage_calls; DELETE FROM rate_limit_readings; DELETE FROM check_runs;`
  );
});

function session(over: { task?: boolean; role?: string } = {}) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, name, tmux_name, working_directory, task_status, role)
     VALUES (?, 'work', ?, '/tmp', ?, ?)`
  ).run(id, `claude-${id}`, over.task ? "running" : null, over.role ?? null);
  return id;
}

const msg = (
  id: string,
  usage: Record<string, unknown>,
  model = "claude-opus-5-5"
) => ({
  id,
  model,
  usage,
});

describe("callFromAssistant", () => {
  it("reads the 5m and 1h cache writes apart, falling back to 5m", () => {
    const split = callFromAssistant(
      msg("m1", {
        input_tokens: 3,
        output_tokens: 7,
        cache_read_input_tokens: k(50),
        cache_creation_input_tokens: k(30),
        cache_creation: {
          ephemeral_5m_input_tokens: k(10),
          ephemeral_1h_input_tokens: k(20),
        },
      }),
      "main",
      null
    )!;
    expect([split.cacheWrite5m, split.cacheWrite1h, split.cacheRead]).toEqual([
      k(10),
      k(20),
      k(50),
    ]);
    const flat = callFromAssistant(
      msg("m2", { cache_creation_input_tokens: k(30) }),
      "main",
      null
    )!;
    expect([flat.cacheWrite5m, flat.cacheWrite1h]).toEqual([k(30), 0]);
  });

  it("skips synthetic messages and ones without an id or usage", () => {
    expect(
      callFromAssistant(msg("a", {}, "<synthetic>"), "main", null)
    ).toBeNull();
    expect(
      callFromAssistant({ model: "x", usage: {} }, "main", null)
    ).toBeNull();
    expect(callFromAssistant({ id: "a", model: "x" }, "main", null)).toBeNull();
  });
});

describe("recordCall", () => {
  it("keeps the highest of each field when one message arrives per block", () => {
    const ctx = sessionContext(session({ task: true }));
    const first = callFromAssistant(
      msg("dup", { input_tokens: 2, output_tokens: 10 }),
      "main",
      null
    )!;
    const later = callFromAssistant(
      msg("dup", { input_tokens: 2, output_tokens: 400 }),
      "main",
      null
    )!;
    recordCall(first, ctx, "live");
    recordCall(later, ctx, "live");
    recordCall(first, ctx, "transcript");
    const rows = db
      .prepare(`SELECT output_tokens, source FROM usage_calls`)
      .all();
    expect(rows).toEqual([{ output_tokens: 400, source: "live" }]);
  });

  it("ties a call to its task only when the session is one", () => {
    const task = session({ task: true });
    const chat = session();
    recordCall(
      callFromAssistant(msg("t", { input_tokens: 1 }), "main", null)!,
      sessionContext(task),
      "live"
    );
    recordCall(
      callFromAssistant(msg("c", { input_tokens: 1 }), "main", null)!,
      sessionContext(chat),
      "live"
    );
    const by = (key: string) =>
      db
        .prepare(`SELECT task_id, role FROM usage_calls WHERE call_key = ?`)
        .get(key);
    expect(by("t")).toEqual({ task_id: task, role: "implement" });
    expect(by("c")).toEqual({ task_id: null, role: "interactive" });
  });

  it("sums a task's weighted cost across its calls, subagents and gate runs", () => {
    const id = session({ task: true });
    const ctx = sessionContext(id);
    recordCall(
      callFromAssistant(msg("a", { input_tokens: k(10) }), "main", null)!,
      ctx,
      "live"
    );
    recordCall(
      callFromAssistant(
        msg("b", { output_tokens: k(1) }),
        "review",
        "review-x"
      )!,
      ctx,
      "live"
    );
    recordCheckRun(
      {
        workspaceId: "w",
        sessionId: id,
        label: "task",
        prNumber: 1,
        sha: "s",
        kind: "review",
      },
      {
        model: "claude-opus-5-5",
        inputTokens: k(1),
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 1,
      }
    );
    expect(taskCosts([id]).get(id)).toBe(k(10) + k(1) * 5 + k(1));
    expect(taskCosts([])).toEqual(new Map());
  });

  it("backfills check runs recorded before the ledger, once", () => {
    db.prepare(
      `INSERT INTO check_runs (workspace_id, session_id, label, sha, kind, model, input_tokens,
         cache_write_tokens, cache_read_tokens, output_tokens, cost_usd, at)
       VALUES ('w', 's', 'l', 'x', 'scope', 'claude-haiku-4-5', 1, 2, 3, 4, 0, 5)`
    ).run();
    expect(backfillCheckRuns()).toBe(1);
    expect(backfillCheckRuns()).toBe(0);
    expect(db.prepare(`SELECT kind, role FROM usage_calls`).get()).toEqual({
      kind: "gate",
      role: "gate-scope",
    });
  });
});

describe("usageEvents", () => {
  const assistant = (over: Record<string, unknown>) =>
    ({
      type: "assistant",
      message: msg("x", { input_tokens: 1 }),
      ...over,
    }) as never;

  it("gives a main call, and a subagent's by the type that started it", () => {
    const agents = new Map<string, string>();
    usageEvents(
      assistant({
        message: {
          ...msg("m", { input_tokens: 1 }),
          content: [
            {
              type: "tool_use",
              id: "tu1",
              name: "Agent",
              input: { subagent_type: "review-security" },
            },
            {
              type: "tool_use",
              id: "tu2",
              name: "Task",
              input: { subagent_type: "Explore" },
            },
          ],
        },
      }),
      agents
    );
    const kind = (parent: string) => {
      const e = usageEvents(
        assistant({ parent_tool_use_id: parent }),
        agents
      )[0];
      return e.type === "call_usage" ? e.call.kind : null;
    };
    expect(kind("tu1")).toBe("review");
    expect(kind("tu2")).toBe("sub");
    const main = usageEvents(assistant({}), agents)[0];
    expect(main.type === "call_usage" && main.call.kind).toBe("main");
  });

  it("passes a rate limit event on and ignores other messages", () => {
    const info = { status: "allowed" };
    expect(
      usageEvents(
        { type: "rate_limit_event", rate_limit_info: info } as never,
        new Map()
      )
    ).toEqual([{ type: "rate_limit", info }]);
    expect(usageEvents({ type: "result" } as never, new Map())).toEqual([]);
  });
});

describe("parseRateLimit", () => {
  it("reads a fraction as a percent and epoch seconds as ms", () => {
    expect(
      parseRateLimit({
        status: "allowed",
        rateLimitType: "seven_day",
        utilization: 0.42,
        resetsAt: 1_800_000_000,
      })
    ).toEqual([
      {
        window: "seven_day",
        utilization: 42,
        raw: 0.42,
        resetsAt: 1_800_000_000_000,
        status: "allowed",
      },
    ]);
  });

  it("takes a plan window object as a percent, and nothing from junk", () => {
    expect(
      parseRateLimit({ rateLimitType: "five_hour", utilization: 0.63 })[0]
        .utilization
    ).toBeCloseTo(63);
    const plan = parseRateLimit({
      five_hour: { utilization: 10, resets_at: "2026-10-12T20:00:00Z" },
      seven_day: { utilization: 55, resets_at: null },
    });
    expect(plan.map((r) => [r.window, r.utilization])).toEqual([
      ["five_hour", 10],
      ["seven_day", 55],
    ]);
    expect(plan[0].resetsAt).toBe(Date.parse("2026-10-12T20:00:00Z"));
    expect(parseRateLimit(null)).toEqual([]);
    expect(
      parseRateLimit({ rateLimitType: "overage", utilization: 1 })
    ).toEqual([]);
    expect(parseRateLimit({ rateLimitType: "seven_day" })).toEqual([]);
  });
});

describe("readings", () => {
  const reading = (u: number, resetsAt: number | null = null) => ({
    window: "seven_day" as const,
    utilization: u,
    raw: u / 100,
    resetsAt,
    status: "allowed",
  });

  it("stores a reading only when it changed", () => {
    expect(recordReadings([reading(40)], "event")).toBe(1);
    expect(recordReadings([reading(40)], "event")).toBe(0);
    expect(recordReadings([reading(41)], "event")).toBe(1);
  });

  it("uses a fresh reading, and past the stale age an estimate labelled so", () => {
    const now = Date.now();
    recordCall(
      {
        ...callFromAssistant(msg("wk", { input_tokens: k(5) }), "main", null)!,
        at: now - 86_400_000,
      },
      sessionContext(session({ task: true })),
      "live"
    );
    recordReadings(
      [reading(40, now + 86_400_000)],
      "event",
      null,
      now - 60_000
    );
    expect(currentWindow("seven_day", now)).toMatchObject({
      pct: 40,
      estimated: false,
    });
    expect(currentWindow("five_hour", now)).toBeNull();
    // 7 hours on, with no new reading.
    const later = now + 7 * 3_600_000;
    expect(currentWindow("seven_day", later)?.estimated).toBe(true);
  });

  it("scales the last reading by the week's recorded usage", () => {
    const now = Date.now();
    const at = now - 3_600_000;
    const ctx = sessionContext(session({ task: true }));
    const put = (key: string, when: number, input: number) =>
      recordCall(
        {
          ...callFromAssistant(
            msg(key, { input_tokens: input }),
            "main",
            null
          )!,
          at: when,
        },
        ctx,
        "live"
      );
    put("old", at - 86_400_000, k(100));
    recordReadings([reading(40, now + 86_400_000)], "event", null, at);
    // The week before the reading held 100k, so 40%; the week to now holds 200k.
    put("new", now - 1000, k(100));
    expect(estimateWeekly(now)).toMatchObject({ pct: 80, estimated: true });
  });

  it("has no estimate before any reading", () => {
    expect(estimateWeekly(Date.now())).toBeNull();
  });
});

describe("the window readings an event carries", () => {
  const event = (five: number, seven: number, extra = {}) => ({
    status: "allowed",
    unifiedWindows: {
      five_hour: { utilization: five, resetsAt: 1_800_018_000 },
      seven_day: { utilization: seven, resetsAt: 1_800_400_000 },
    },
    ...extra,
  });

  it("reads both windows from unifiedWindows, as percent and ms", () => {
    expect(parseRateLimit(event(0.06, 0.31))).toEqual([
      {
        window: "five_hour",
        utilization: 6,
        raw: 0.06,
        resetsAt: 1_800_018_000_000,
        status: "allowed",
      },
      {
        window: "seven_day",
        utilization: 31,
        raw: 0.31,
        resetsAt: 1_800_400_000_000,
        status: "allowed",
      },
    ]);
  });

  it("keeps one reading per window, preferring unifiedWindows", () => {
    const r = parseRateLimit(
      event(0.06, 0.31, {
        rateLimitType: "five_hour",
        utilization: 0.05,
        resetsAt: 1_800_018_000,
      })
    );
    expect(r.map((x) => [x.window, x.utilization])).toEqual([
      ["five_hour", 6],
      ["seven_day", 31],
    ]);
  });

  it("skips malformed windows", () => {
    expect(
      parseRateLimit({
        unifiedWindows: { five_hour: { utilization: "x" }, seven_day: null },
      })
    ).toEqual([]);
  });

  it("refreshes an unchanged reading's time once a minute, not a row", () => {
    const count = () =>
      (
        db.prepare(`SELECT count(*) AS n FROM rate_limit_readings`).get() as {
          n: number;
        }
      ).n;
    const readings = parseRateLimit(event(0.06, 0.31));
    const t0 = 1_800_000_000_000;
    expect(recordReadings(readings, "event", null, t0)).toBe(2);
    expect(recordReadings(readings, "event", null, t0 + 30_000)).toBe(0);
    expect(lastReading("five_hour")?.at).toBe(t0);
    expect(recordReadings(readings, "event", null, t0 + 90_000)).toBe(0);
    expect(lastReading("five_hour")?.at).toBe(t0 + 90_000);
    expect(count()).toBe(2);
  });

  it("gives the current period's last hour as a series", () => {
    const t0 = 1_800_000_000_000;
    const at = (u: number, reset: number, when: number) =>
      recordReadings(
        parseRateLimit({
          unifiedWindows: { five_hour: { utilization: u, resetsAt: reset } },
        }),
        "event",
        null,
        when
      );
    at(0.9, 1_799_990_000, t0 - 4 * 3_600_000);
    at(0.1, 1_800_018_000, t0 - 3_000_000);
    at(0.2, 1_800_018_000, t0);
    const w = windowSamples("five_hour");
    expect(w.resetsAt).toBe(1_800_018_000_000);
    expect(w.samples).toEqual([
      [(t0 - 3_000_000) / 1000, 10],
      [t0 / 1000, 20],
    ]);
  });
});
