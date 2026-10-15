import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  MAX_WAKES,
  WAKE_GIVE_UP_MS,
  healthTick,
  resetTick,
  type TickDeps,
} from "./tick";
import { PHONE_CAP_PER_DAY, chatLine, type RouteDeps } from "./route";
import { listNotes } from "./notes";
import { openAnomalies } from "./store";
import { NOW, config, facts } from "./fixtures";
import { MIN, type HealthFacts, type Verdict } from "./types";

const red = (since: number) =>
  facts({
    machines: [
      { id: "local", label: "This machine", level: "red", redSince: since },
    ],
  });

function setup(opts: { verdict?: Partial<Verdict>; fail?: boolean } = {}) {
  const queued: { ws: string; key: string; line: string; low: boolean }[] = [];
  const phoned: string[] = [];
  let current: HealthFacts = red(NOW - 11 * MIN);
  const route: RouteDeps = {
    queue: ((
      ws: string,
      key: string,
      _s: string | null,
      line: string,
      _n: number,
      low: boolean
    ) => {
      if (queued.some((q) => q.ws === ws && q.key === key)) return false;
      queued.push({ ws, key, line, low });
      return true;
    }) as RouteDeps["queue"],
    phone: ((_s: string, text: string) =>
      void phoned.push(text)) as RouteDeps["phone"],
    workspaces: () => ["w1", "w2"],
  };
  const wake = vi.fn(async () => {
    if (opts.fail) throw new Error("boom");
    return {
      verdict: {
        real: true,
        cause: "Two archives are running.",
        action: "Place new tasks on the box.",
        saadOnly: false,
        ...opts.verdict,
      } as Verdict,
      tokens: { input: 7000, output: 200 },
    };
  });
  const deps: TickDeps = {
    config: () => config(),
    facts: () => current,
    watch: { run: vi.fn(), usagePct: () => null },
    route,
    wake: wake as unknown as TickDeps["wake"],
  };
  return {
    queued,
    phoned,
    wake,
    deps,
    set: (f: HealthFacts) => (current = f),
    tick: async (now: number) =>
      void (await Promise.all(healthTick(now, deps))),
  };
}

beforeEach(() => {
  resetTick();
  db.exec(`DELETE FROM health_anomalies; DELETE FROM watcher_notes;`);
});

describe("the health tick", () => {
  it("does nothing, and costs no wake, when nothing is wrong", async () => {
    const s = setup();
    s.set(facts());
    await s.tick(NOW);
    expect(s.wake).not.toHaveBeenCalled();
    expect(s.queued).toEqual([]);
  });

  it("one persisting anomaly is one wake, one chat line, no phone", async () => {
    const s = setup();
    for (let i = 0; i < 10; i++) await s.tick(NOW + i * 61_000);
    expect(s.wake).toHaveBeenCalledTimes(1);
    // The anomaly has no workspace, so every orchestrator hears it once.
    expect(s.queued.map((q) => q.ws)).toEqual(["w1", "w2"]);
    expect(s.queued[0].line).toContain("Health (scheduler)");
    expect(s.queued[0].line).toContain("Two archives are running.");
    expect(s.queued[0].line).toContain("Suggest: Place new tasks on the box.");
    expect(s.queued[0].low).toBe(true);
    expect(s.phoned).toEqual([]);
    const [row] = openAnomalies();
    expect(row.tokens_in).toBe(7000);
    expect(row.delivered_at).not.toBeNull();
  });

  it("ticks at most once a minute", async () => {
    const s = setup();
    await s.tick(NOW);
    s.set(red(NOW - 30 * MIN));
    await s.tick(NOW + 30_000);
    expect(openAnomalies()[0].hits).toBe(1);
  });

  it("wakes again, and says so, when it gets worse", async () => {
    const s = setup();
    await s.tick(NOW);
    s.set(red(NOW - 40 * MIN));
    await s.tick(NOW + 2 * MIN);
    expect(s.wake).toHaveBeenCalledTimes(2);
    expect(s.queued.map((q) => q.key.split(":").pop())).toContain("high");
    expect(s.queued.filter((q) => q.key.endsWith(":high"))[0].low).toBe(false);
  });

  it("phones once, only when the watcher says it needs the person", async () => {
    const s = setup({ verdict: { saadOnly: true } });
    await s.tick(NOW);
    s.set(red(NOW - 40 * MIN));
    await s.tick(NOW + 2 * MIN);
    expect(s.phoned).toHaveLength(1);
    // The detector's words, not the model's or a log's.
    expect(s.phoned[0]).toContain("This machine load has been red");
    expect(s.phoned[0]).not.toContain("Two archives");
    expect(s.queued[0].low).toBe(false);
  });

  it("keeps phone pushes to a daily cap", async () => {
    const s = setup({ verdict: { saadOnly: true } });
    for (let i = 0; i < PHONE_CAP_PER_DAY + 3; i++) {
      s.set(
        facts({
          machines: [
            {
              id: `m${i}`,
              label: `Machine ${i}`,
              level: "red",
              redSince: NOW - 11 * MIN,
            },
          ],
        })
      );
      await s.tick(NOW + i * 2 * MIN);
    }
    expect(s.phoned).toHaveLength(PHONE_CAP_PER_DAY);
  });

  it("a verdict of 'normal' stays out of the chat and teaches the notes", async () => {
    const s = setup({
      verdict: { real: false, note: "Load is red during TestFlight archives." },
    });
    await s.tick(NOW);
    expect(s.queued).toEqual([]);
    expect(s.phoned).toEqual([]);
    expect(listNotes("scheduler").map((n) => n.line)).toEqual([
      "Load is red during TestFlight archives.",
    ]);
    expect(openAnomalies()[0].delivered_at).not.toBeNull();
  });

  it("a watcher that throws still gets the detector's line to the chat", async () => {
    const s = setup({ fail: true });
    await s.tick(NOW);
    expect(s.queued).toHaveLength(2);
    expect(s.queued[0].line).toContain("unjudged");
    expect(s.queued[0].line).toContain("This machine load has been red");
  });

  it("wakes at most two at a time and the rest on the next tick", async () => {
    const s = setup();
    s.set(
      facts({
        machines: ["a", "b", "c"].map((id) => ({
          id,
          label: id,
          level: "red" as const,
          redSince: NOW - 11 * MIN,
        })),
      })
    );
    const first = healthTick(NOW, s.deps);
    expect(first).toHaveLength(MAX_WAKES);
    await Promise.all(first);
    await s.tick(NOW + 2 * MIN);
    expect(s.wake).toHaveBeenCalledTimes(3);
  });

  it("closes with one short line once it clears, if the chat ever heard of it", async () => {
    const s = setup();
    await s.tick(NOW);
    s.set(facts());
    await s.tick(NOW + 6 * MIN);
    const closed = s.queued.filter((q) => q.key.endsWith(":closed"));
    expect(closed).toHaveLength(2);
    expect(closed[0].line).toContain("cleared after");
    expect(closed[0].low).toBe(true);
    expect(openAnomalies()).toEqual([]);
  });

  it("gives up on a wake a restart cut off and delivers the detector's line", async () => {
    const s = setup();
    db.prepare(
      `INSERT INTO health_anomalies (check_id, subject, area, severity, line, opened_at, last_seen_at, woken_severity, woken_at)
       VALUES ('load-red', 'local', 'scheduler', 'warn', 'Cut off.', ?, ?, 'warn', ?)`
    ).run(NOW - 10 * MIN, NOW, NOW - WAKE_GIVE_UP_MS - 1);
    s.set(red(NOW - 11 * MIN));
    await s.tick(NOW);
    expect(s.queued[0].line).toContain("unjudged");
    expect(s.wake).not.toHaveBeenCalled();
  });
});

describe("the chat line", () => {
  it("fences what the watcher said as data", () => {
    const line = chatLine(
      {
        area: "tasks",
        line: "Background job quiet 21m.",
      } as never,
      {
        real: true,
        cause: "Build exited 65.",
        action: "Stop the monitor.",
        saadOnly: false,
      }
    );
    expect(line).toContain("Health (tasks):");
    expect(line).toMatch(
      /<untrusted source="health watcher">Build exited 65\. Suggest: Stop the monitor\.<\/untrusted>/
    );
  });
});
