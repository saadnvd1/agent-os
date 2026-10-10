// The machine-load monitor: samples the load every 10s and each session's
// process trees every 30s, pushes both over /ws/status, and raises one alert
// when the load stays red. It never stops, pauses or queues anything.
import os from "os";
import { db } from "../db";
import { publishLoad } from "../status/hub";
import { LoadAlarm } from "./alarm";
import { HeavyRegistry, type HeavyRun } from "./heavy";
import { nextLevel, type LoadLevel, type Pressure } from "./level";
import { readPressure } from "./pressure";
import { readUsage, type Usage } from "./usage";
import { workerTmuxName } from "../chat/worker/protocol";
import { alertText, raiseAlert } from "./alert";

export const SAMPLE_MS = 10_000;
export const USAGE_MS = 30_000;
// A row shows its usage from here up.
const BUSY_CORES = 0.5;

export interface SessionLoad extends Usage {
  sessionId: string;
  name: string;
  heavy: string[];
}

export interface LoadView {
  level: LoadLevel;
  load1: number;
  cores: number;
  memUsedPct: number;
  pressure: Pressure;
  top: SessionLoad[];
  sessions: Record<string, Usage>;
}

interface State {
  level: LoadLevel | null;
  view: LoadView | null;
  usage: Record<string, SessionLoad>;
  registry: HeavyRegistry;
  alarm: LoadAlarm;
  timers: ReturnType<typeof setInterval>[];
}

// Shared by the custom server and the Next.js route bundles.
const g = globalThis as unknown as { __agentosLoad?: State };
const state: State = (g.__agentosLoad ??= {
  level: null,
  view: null,
  usage: {},
  registry: new HeavyRegistry(),
  alarm: new LoadAlarm(),
  timers: [],
});

export const heavyRegistry = () => state.registry;
// AGENTOS_LOAD=off: no sampling, no notes, no alerts.
export const loadEnabled = () => process.env.AGENTOS_LOAD !== "off";
export const currentLevel = () => state.level;

const heavyBySession = (runs: HeavyRun[]) => {
  const out = new Map<string, string[]>();
  for (const r of runs)
    if (r.sessionId)
      out.set(r.sessionId, [...(out.get(r.sessionId) ?? []), r.label]);
  return out;
};

function topSessions(): SessionLoad[] {
  const heavy = heavyBySession(state.registry.active());
  return Object.values(state.usage)
    .map((s) => ({ ...s, heavy: heavy.get(s.sessionId) ?? [] }))
    .sort((a, b) => b.cores - a.cores)
    .slice(0, 5);
}

async function sample(): Promise<void> {
  const cores = os.cpus().length || 1;
  const load1 = os.loadavg()[0];
  const pressure = await readPressure();
  const level = nextLevel(state.level ?? "green", load1 / cores, pressure);
  state.level = level;
  const total = os.totalmem();
  const sessions: Record<string, Usage> = {};
  for (const s of Object.values(state.usage))
    if (s.cores >= BUSY_CORES)
      sessions[s.sessionId] = { cores: s.cores, rssBytes: s.rssBytes };
  const view: LoadView = {
    level,
    load1: Math.round(load1 * 10) / 10,
    cores,
    memUsedPct: Math.round(((total - os.freemem()) / total) * 100),
    pressure,
    top: topSessions(),
    sessions,
  };
  state.view = view;
  publishLoad(JSON.stringify({ type: "load", load: view }));
  if (feedAlarm(level, Date.now())) raiseAlert(alertText(view));
}

// Whether the alarm may fire, across restarts: a deploy during a long red
// stretch mustn't send the same alert again.
const ARMED_KEY = "load.alarm_armed";

function readArmed(): boolean {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = ?`)
    .get(ARMED_KEY) as { value: string } | undefined;
  return row?.value !== "0";
}

function saveArmed(armed: boolean): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(ARMED_KEY, armed ? "1" : "0");
}

// The alarm, with its armed state saved whenever it changes.
export function feedAlarm(level: LoadLevel, now: number): boolean {
  const armed = state.alarm.isArmed;
  const fire = state.alarm.feed(level, now);
  if (state.alarm.isArmed !== armed) saveArmed(state.alarm.isArmed);
  return fire;
}

// As a restart finds it.
export function loadAlarmFromDb(): void {
  state.alarm = new LoadAlarm(readArmed());
}

type UsageRow = { id: string; name: string; tmux_name: string };

// Each session's share of the usage: its own tmux session's, plus its chat
// worker's, where a chat's agent runs.
export function sessionUsage(
  byTmux: Record<string, Usage>,
  rows: UsageRow[]
): Record<string, SessionLoad> {
  const usage: Record<string, SessionLoad> = {};
  for (const row of rows) {
    const parts = [byTmux[row.tmux_name], byTmux[workerTmuxName(row.id)]];
    const found = parts.filter((u): u is Usage => !!u);
    if (!found.length) continue;
    const cores = found.reduce((n, u) => n + u.cores, 0);
    usage[row.id] = {
      sessionId: row.id,
      name: row.name,
      cores: Math.round(cores * 10) / 10,
      rssBytes: found.reduce((n, u) => n + u.rssBytes, 0),
      heavy: [],
    };
  }
  return usage;
}

async function sampleUsage(): Promise<void> {
  const byTmux = await readUsage();
  const rows = db
    .prepare(
      `SELECT id, name, tmux_name FROM sessions WHERE archived_at IS NULL AND host_id = 'local'`
    )
    .all() as UsageRow[];
  state.usage = sessionUsage(byTmux, rows);
}

// Off the hot path: each tick is async, never overlaps the last, and logs
// rather than throws.
function guarded(fn: () => Promise<void>): () => Promise<void> {
  let busy = false;
  return async () => {
    if (busy) return;
    busy = true;
    try {
      await fn();
    } catch (err) {
      console.error("[load]", err);
    } finally {
      busy = false;
    }
  };
}

export function startLoadMonitor(): void {
  if (state.timers.length) return;
  loadAlarmFromDb();
  const tickSample = guarded(sample);
  const tickUsage = guarded(async () => {
    await sampleUsage();
    await sample();
  });
  state.timers.push(setInterval(tickSample, SAMPLE_MS));
  state.timers.push(setInterval(tickUsage, USAGE_MS));
  state.timers.forEach((t) => t.unref?.());
  void tickUsage();
}
