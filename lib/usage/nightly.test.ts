import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { db, insertSessionRow } from "../db";
import { callFromAssistant, recordCall, sessionContext } from "./calls";
import {
  lightPass,
  nightly,
  usageRollupEnabled,
  type NightlyDeps,
} from "./nightly";
import {
  escapesIn,
  escapesOf,
  qualityOf,
  taskQuality,
  type MergedPR,
} from "./quality";
import { loadBaseline } from "./ratchet";
import { dayKey, dayStart, loadRollups, rollupDay } from "./rollup";
import { computeRollup, type CallGroup } from "./span";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const sql = (ms: number) =>
  new Date(ms).toISOString().slice(0, 19).replace("T", " ");

beforeEach(() => {
  db.exec(`
    DELETE FROM usage_calls; DELETE FROM usage_rollups; DELETE FROM usage_baseline;
    DELETE FROM usage_alerts; DELETE FROM orchestrator_checks; DELETE FROM sessions;
    DELETE FROM settings WHERE key LIKE 'usage.%'; DELETE FROM rate_limit_readings;
  `);
});

function mergedTask(
  at: number,
  over: { review?: string; ci?: string; second?: boolean } = {}
) {
  const id = randomUUID();
  insertSessionRow(db, {
    id,
    name: "t",
    tmux_name: `claude-${id}`,
    working_directory: "/tmp",
    task_status: "merged",
    merged_at: sql(at),
  });
  const check = (sha: string, kind: string, status: string) =>
    db
      .prepare(
        `INSERT INTO orchestrator_checks (workspace_id, session_id, sha, kind, status)
         VALUES ('w', ?, ?, ?, ?)`
      )
      .run(id, sha, kind, status);
  check("a", "review", over.review ?? "pass");
  check("a", "ci", over.ci ?? "pass");
  if (over.second) check("b", "review", "pass");
  return id;
}

describe("taskQuality", () => {
  const checks = (rows: [number, string, string, string][]) =>
    rows.map(([id, sha, kind, status]) => ({
      id,
      session_id: "t",
      sha,
      kind,
      status,
    }));

  it("is clean when the first reviewed head passed review and CI untouched", () => {
    const q = taskQuality(
      "t",
      checks([
        [1, "a", "review", "pass"],
        [2, "a", "ci", "pass"],
      ]),
      0
    );
    expect(q).toMatchObject({ reviewed: true, clean: true, fixRounds: 0 });
  });

  it("is not clean on a blocked review, red CI, a gate failure or a later head", () => {
    const base: [number, string, string, string][] = [
      [1, "a", "review", "pass"],
      [2, "a", "ci", "pass"],
    ];
    expect(
      taskQuality(
        "t",
        checks([
          [1, "a", "review", "block"],
          [2, "a", "ci", "pass"],
        ]),
        0
      ).clean
    ).toBe(false);
    expect(
      taskQuality(
        "t",
        checks([
          [1, "a", "review", "pass"],
          [2, "a", "ci", "block"],
        ]),
        0
      ).clean
    ).toBe(false);
    expect(taskQuality("t", checks(base), 1).clean).toBe(false);
    const fixed = taskQuality(
      "t",
      checks([...base, [3, "b", "review", "pass"], [4, "c", "review", "pass"]]),
      0
    );
    expect(fixed).toMatchObject({ clean: false, fixRounds: 2 });
  });

  it("counts a merge nobody reviewed as not clean", () => {
    expect(taskQuality("t", [], 0)).toMatchObject({
      reviewed: false,
      clean: false,
    });
  });

  it("reads checks and gate failures from the database", () => {
    const at = Date.now();
    const clean = mergedTask(at);
    const reworked = mergedTask(at, { second: true });
    const failed = mergedTask(at);
    db.prepare(
      `INSERT INTO orchestrator_gate_failures (session_id, gate, workspace_id, count) VALUES (?, 'ci', 'w', 2)`
    ).run(failed);
    const q = new Map(
      qualityOf(
        [clean, reworked, failed].map((id) => ({
          id,
          projectId: null,
          prNumber: null,
          mergedAt: "",
        }))
      ).map((x) => [x.id, x])
    );
    expect(q.get(clean)?.clean).toBe(true);
    expect(q.get(reworked)).toMatchObject({ clean: false, fixRounds: 1 });
    expect(q.get(failed)).toMatchObject({ clean: false, gateFailures: 2 });
  });
});

describe("escapes", () => {
  const pr = (
    number: number,
    title: string,
    hoursAfter: number,
    files: string[]
  ): MergedPR => ({
    number,
    title,
    mergedAt: Date.UTC(2026, 9, 1) + hoursAfter * HOUR,
    files,
  });
  const base = pr(1, "feat: x", 0, ["a.ts", "b.ts"]);

  it("flags a fix or revert within 72h that shares a file", () => {
    const all = (q: MergedPR) => [base, q];
    expect(
      escapesOf([base], all(pr(2, "fix(ui): y", 71, ["b.ts"])))
    ).toHaveLength(1);
    expect(
      escapesOf([base], all(pr(2, 'Revert "feat: x"', 5, ["a.ts"])))
    ).toHaveLength(1);
    expect(escapesOf([base], all(pr(2, "fix: y", 73, ["b.ts"])))).toHaveLength(
      0
    );
    expect(escapesOf([base], all(pr(2, "fix: y", 5, ["c.ts"])))).toHaveLength(
      0
    );
    expect(escapesOf([base], all(pr(2, "feat: y", 5, ["a.ts"])))).toHaveLength(
      0
    );
    expect(escapesOf([base], all(pr(2, "fix: y", -5, ["a.ts"])))).toHaveLength(
      0
    );
  });

  it("is unknown, not zero, when gh can't say", async () => {
    const project = randomUUID();
    db.prepare(
      `INSERT INTO projects (id, name, working_directory) VALUES (?, 'p', '/tmp')`
    ).run(project);
    const t = {
      id: "t",
      projectId: project,
      prNumber: 1,
      mergedAt: "2026-10-01 00:00:00",
    };
    expect(
      await escapesIn([t], async () => {
        throw new Error("rate limited");
      })
    ).toBeNull();
    expect(await escapesIn([{ ...t, prNumber: null }], async () => "[]")).toBe(
      0
    );
    db.prepare(`DELETE FROM projects WHERE id = ?`).run(project);
  });
});

describe("computeRollup", () => {
  const group = (over: Partial<CallGroup>): CallGroup => ({
    kind: "main",
    role: "implement",
    model: "claude-opus-5-5",
    provider: "anthropic",
    calls: 1,
    ctxKnown: 1,
    over200k: 0,
    input_tokens: 0,
    cache_read_tokens: 0,
    cache_write_5m_tokens: 0,
    cache_write_1h_tokens: 0,
    output_tokens: 0,
    ...over,
  });
  const inputs = (groups: CallGroup[]) => ({
    day: "2026-10-01",
    groups,
    merged: 2,
    clean: 1,
    fixRounds: 1,
    escalations: 0,
    scopeChanges: 0,
    escapes: 0,
    weeklyPct: null,
    weeklyEstimated: false,
  });

  it("leaves a person's own sessions out of work and splits review, orchestrator and mix", () => {
    const r = computeRollup(
      inputs([
        group({ input_tokens: 1000 }),
        group({ role: "interactive", input_tokens: 400 }),
        group({
          kind: "review",
          role: "implement",
          input_tokens: 200,
          model: "claude-sonnet-5-5",
        }),
        group({ kind: "gate", role: "gate-review", input_tokens: 100 }),
        group({
          role: "orchestrator",
          input_tokens: 300,
          calls: 4,
          over200k: 2,
          ctxKnown: 4,
        }),
      ])
    );
    expect(r.weighted).toBe(1000 + 400 + 100 + 100 + 300);
    expect(r.work).toBe(1000 + 100 + 100 + 300);
    expect(r.review).toBe(200);
    expect(r.orchestrator).toBe(300);
    expect(r.mix).toEqual({ opus: 1800, sonnet: 100, haiku: 0 });
    expect(r.over200k).toBe(2);
    expect(r.ctxKnown).toBe(8);
  });

  it("leaves other providers out", () => {
    const r = computeRollup(
      inputs([group({ provider: "openai", input_tokens: 5000 })])
    );
    expect(r.weighted).toBe(0);
  });
});

describe("usageRollupEnabled", () => {
  it("is off in dev unless asked, on in production unless turned off", () => {
    expect(usageRollupEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(
      usageRollupEnabled({
        NODE_ENV: "development",
        AGENTOS_USAGE_ROLLUP: "on",
      })
    ).toBe(true);
    expect(usageRollupEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(
      usageRollupEnabled({
        NODE_ENV: "production",
        AGENTOS_USAGE_ROLLUP: "off",
      })
    ).toBe(false);
    expect(
      usageRollupEnabled({ NODE_ENV: "production", AGENTOS_DEV: "1" })
    ).toBe(false);
  });
});

describe("nightly", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "aos-usage-"));
  const sent: string[] = [];
  const deps = (now: number): NightlyDeps => ({
    now: () => now,
    notify: (t) => sent.push(t),
    transcriptsRoot: empty,
  });
  const noon = (day: string) => dayStart(day) + 12 * HOUR;

  // A day of work: `merges` clean merges and `cost` weighted tokens.
  function seedDay(day: string, merges: number, cost: number) {
    for (let i = 0; i < merges; i++) mergedTask(noon(day) + i);
    const id = randomUUID();
    insertSessionRow(db, {
      id,
      name: "w",
      tmux_name: `claude-${id}`,
      working_directory: "/tmp",
      task_status: "running",
    });
    recordCall(
      {
        ...callFromAssistant(
          {
            id: `c-${day}`,
            model: "claude-opus-5-5",
            usage: { input_tokens: cost },
          },
          "main",
          null
        )!,
        at: noon(day),
      },
      sessionContext(id),
      "live"
    );
  }

  it("seeds the week, sets the baseline, alerts once on a regression", async () => {
    sent.length = 0;
    const today = new Date(2026, 9, 20, 12).getTime();
    for (let i = 7; i >= 1; i--) seedDay(dayKey(today - i * DAY), 4, 4000);
    await nightly(deps(today));
    expect(loadRollups(30).filter((r) => r.day < dayKey(today))).toHaveLength(
      7
    );
    expect(loadBaseline()?.values).toMatchObject({
      costPerMerged: 1000,
      cleanRate: 1,
    });
    expect(sent).toEqual([]);

    // Three days at twice the cost.
    for (let i = 0; i < 3; i++) seedDay(dayKey(today + i * DAY), 4, 8000);
    const later = today + 3 * DAY;
    await nightly(deps(later));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("cost per merged PR");
    expect(sent[0]).toContain("100% over baseline");
    await nightly(deps(later));
    expect(sent).toHaveLength(1);
    expect(loadBaseline()?.values.costPerMerged).toBe(1000);
  });

  it("keeps today's row current in a light pass and marks recent days not final", async () => {
    const now = new Date(2026, 9, 20, 12).getTime();
    seedDay("2026-10-20", 1, 500);
    await lightPass(deps(now));
    const today = loadRollups(1)[0];
    expect(today).toMatchObject({ day: "2026-10-20", merged: 1, work: 500 });
    expect((await rollupDay("2026-10-20", now)).work).toBe(500);
    const final = db.prepare(`SELECT final FROM usage_rollups`).all();
    expect(final).toEqual([{ final: 0 }]);
  });
});
