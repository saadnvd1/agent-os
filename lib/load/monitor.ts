// The machine-load monitor: samples the load every 10s and each session's
// process trees every 30s, pushes both over /ws/status, and raises one alert
// when the load stays red. It never stops or pauses anything; it feeds the
// start gate (start-gate.ts) that holds queued tasks while the load is red.
import os from "os";
import { db } from "../db";
import { publishLoad } from "../status/hub";
import { LoadAlarm } from "./alarm";
import { HeavyRegistry, type HeavyRun } from "./heavy";
import { nextLevel, type LoadLevel, type Pressure } from "./level";
import { readPressure } from "./pressure";
import type { Usage } from "./usage";
import { readSnapshot } from "./usage";
import {
  attributeLoad,
  BUSY_CORES,
  claimSessions,
  cwdCandidates,
  readCwds,
  type ProcGroup,
  type SessionLoad,
  type SessionRow,
} from "./attribute";
import { alertText, raiseAlert } from "./alert";
import { LOCAL, feedGate, gateOpen } from "./start-gate";

export const SAMPLE_MS = 10_000;
export const USAGE_MS = 30_000;
export type { SessionLoad, ProcGroup };

export interface LoadView {
  level: LoadLevel;
  load1: number;
  cores: number;
  memUsedPct: number;
  pressure: Pressure;
  top: SessionLoad[];
  // Heavy processes that belong to no session, grouped by name.
  unattributed: ProcGroup[];
  sessions: Record<string, Usage>;
}

interface State {
  level: LoadLevel | null;
  view: LoadView | null;
  usage: Record<string, SessionLoad>;
  unattributed: ProcGroup[];
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
  unattributed: [],
  registry: new HeavyRegistry(),
  alarm: new LoadAlarm(),
  timers: [],
});

// The queue lives above this module (it reads the load); reach it lazily.
function nudgeQueue(): void {
  void import("../tasks/queue")
    .then((q) => q.tickQueueSoon())
    .catch(() => undefined);
}

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
  const prev = state.level;
  const level = nextLevel(prev ?? "green", load1 / cores, pressure);
  state.level = level;
  const t = Date.now();
  const wasOpen = gateOpen(LOCAL, prev, t);
  feedGate(LOCAL, level, t);
  // Starts held for load go ahead within a sample of the gate opening.
  if (prev !== level || wasOpen !== gateOpen(LOCAL, level, t)) nudgeQueue();
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
    unattributed: state.unattributed,
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

async function sampleUsage(): Promise<void> {
  const { procs, panes } = await readSnapshot();
  const rows = db
    .prepare(
      `SELECT id, name, tmux_name, worktree_path, working_directory FROM sessions WHERE archived_at IS NULL AND host_id = 'local'`
    )
    .all() as SessionRow[];
  const owner = claimSessions(procs, panes, rows);
  const cwds = await readCwds(cwdCandidates(procs, owner));
  const { sessions, unattributed } = attributeLoad({
    procs,
    owner,
    rows,
    cwds,
    home: os.homedir(),
  });
  state.usage = sessions;
  state.unattributed = unattributed;
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
