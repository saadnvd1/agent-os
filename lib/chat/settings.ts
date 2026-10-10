/**
 * What a chat agent offers in a folder (commands, skills, models) and the
 * per-session settings that go with them: the model and the access level.
 */

import os from "os";
import { db, type Session } from "../db";
import { agentEnv } from "../agents/launch";
import { resolveModelForAgent } from "../model-catalog";
import { chatDriverFor } from "./drivers";
import {
  CHAT_ACCESS,
  type ChatAccess,
  type ChatCommand,
  type ChatServerMessage,
} from "./events";
import {
  createSkillWatcher,
  skillFolders,
  type SkillWatcher,
} from "./skill-watch";
import {
  emit,
  getSession,
  registry,
  type Capabilities,
  type Listener,
} from "./registry";

const CAPS_TTL_MS = 10 * 60 * 1000;

// Commands that only make sense in a terminal UI, hidden from chat when the
// agent doesn't say so itself.
const TERMINAL_ONLY = new Set([
  "exit",
  "quit",
  "statusline",
  "terminal-setup",
  "vim",
  "color",
  "theme",
  "ide",
  "heapdump",
  "config",
  "resume",
  "login",
  "logout",
]);

export const capsKey = (s: Session) => `${s.agent_type}:${s.working_directory}`;

// The session's own model when it has one; the agent's default otherwise.
export function chatModel(session: Session): string {
  return (
    session.model?.trim() || resolveModelForAgent(session.agent_type, null)
  );
}

function visibleCommands(caps: Capabilities): ChatCommand[] {
  return caps.commands.filter(
    (c) =>
      !c.name.startsWith("__") &&
      !caps.terminalOnly.has(c.name) &&
      !TERMINAL_ONLY.has(c.name)
  );
}

export function emitCapabilities(session: Session, listener?: Listener): void {
  const caps = registry.caps.get(capsKey(session));
  if (!caps) return;
  const m: ChatServerMessage = {
    type: "capabilities",
    commands: visibleCommands(caps),
    models: caps.models,
    model: chatModel(session),
    access: session.chat_access,
    plan: canPlan(session) ? !!session.chat_plan : null,
  };
  if (listener) listener(m);
  else emit(session.id, m);
}

const cwdOf = (s: Session) => s.working_directory.replace(/^~/, os.homedir());

// An agent that hangs while starting would hold its key's reloads forever.
const DISCOVER_TIMEOUT_MS = 30_000;
// Agent processes started at once by a change to a folder many chats read.
const RELOADS_AT_ONCE = 2;

// Discovery, ended (the agent process with it) if it takes too long.
async function discoverWithin(
  driver: NonNullable<ReturnType<typeof chatDriverFor>>,
  session: Session,
  ms: number
) {
  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(new Error("Discovery timed out")),
    ms
  );
  timer.unref?.();
  try {
    return await Promise.race([
      driver.discover({
        cwd: cwdOf(session),
        env: agentEnv(session.id),
        signal: ac.signal,
      }),
      // For a driver that doesn't watch the signal itself.
      new Promise<never>((_, reject) =>
        ac.signal.addEventListener("abort", () => reject(ac.signal.reason), {
          once: true,
        })
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Shared across module instances, like the registry: the watcher calls back
// into whichever copy made it.
interface Watch {
  watcher: SkillWatcher;
  sweep?: NodeJS.Timeout;
  // The newest load per key: an older one finishing later doesn't win.
  loads: Map<string, { gen: number; done: Promise<void> }>;
  gen: number;
  reloading: Map<string, { again: boolean; done: Promise<void> }>;
  running: number;
  queued: (() => void)[];
}
const g = globalThis as unknown as { __agentosSkillWatch?: Watch };
const watch = (): Watch =>
  (g.__agentosSkillWatch ??= {
    watcher: createSkillWatcher((key) => void reloadOnChange(key)),
    loads: new Map(),
    gen: 0,
    reloading: new Map(),
    running: 0,
    queued: [],
  });

// A watched folder changed: reload, a few keys at a time.
export const reloadOnChange = (key: string): Promise<void> =>
  oneOfFew(() => reloadCapabilities(key)).catch((error) =>
    console.error("Could not reload chat commands:", error)
  );

// Runs `fn` once fewer than RELOADS_AT_ONCE others are.
function oneOfFew(fn: () => Promise<void>): Promise<void> {
  const w = watch();
  return new Promise<void>((resolve, reject) => {
    const run = () => {
      w.running++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          w.running--;
          w.queued.shift()?.();
        });
    };
    if (w.running < RELOADS_AT_ONCE) run();
    else w.queued.push(run);
  });
}

async function loadCapabilities(
  session: Session,
  force = false
): Promise<void> {
  const w = watch();
  const key = capsKey(session);
  const cached = registry.caps.get(key);
  if (!force && cached && Date.now() - cached.at < CAPS_TTL_MS) return;
  // One already on its way will do, unless it may predate a change.
  const loading = w.loads.get(key);
  if (loading && !force) return loading.done;
  const driver = chatDriverFor(session.agent_type);
  if (!driver) return;
  w.watcher.watch(key, skillFolders(cwdOf(session)));
  const gen = ++w.gen;
  const done = (async () => {
    const found = await discoverWithin(driver, session, DISCOVER_TIMEOUT_MS);
    if (w.loads.get(key)?.gen !== gen) return;
    registry.caps.set(key, {
      ...found,
      terminalOnly: registry.caps.get(key)?.terminalOnly ?? new Set(),
      at: Date.now(),
    });
  })().finally(() => {
    if (w.loads.get(key)?.gen === gen) w.loads.delete(key);
  });
  w.loads.set(key, { gen, done });
  return done;
}

// Local sessions with a chat open.
function watchedSessions(): Session[] {
  const out: Session[] = [];
  for (const [id, set] of registry.listeners) {
    if (!set.size) continue;
    try {
      const s = getSession(id);
      if (!s.host_id || s.host_id === "local") out.push(s);
    } catch {}
  }
  return out;
}

// Loads `key`'s commands afresh and tells every chat open on it. A reload
// asked for while one runs runs once more after it, not alongside.
export function reloadCapabilities(
  key: string,
  fallback?: Session
): Promise<void> {
  const w = watch();
  const busy = w.reloading.get(key);
  if (busy) {
    busy.again = true;
    return busy.done;
  }
  const state = { again: true, done: Promise.resolve() };
  w.reloading.set(key, state);
  state.done = (async () => {
    try {
      while (state.again) {
        state.again = false;
        const open = watchedSessions().filter((s) => capsKey(s) === key);
        const session = open[0] ?? fallback;
        if (!session) {
          // Nobody's looking: stop watching, and load again when someone is.
          registry.caps.delete(key);
          w.watcher.release(key);
          return;
        }
        await loadCapabilities(session, true);
        watchedSessions()
          .filter((s) => capsKey(s) === key)
          .forEach((s) => emitCapabilities(s));
      }
    } finally {
      w.reloading.delete(key);
    }
  })();
  return state.done;
}

// The "/" menu's refresh: that session's commands, bypassing the cache.
export async function refreshCapabilities(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (session.host_id && session.host_id !== "local") return;
  await reloadCapabilities(capsKey(session), session);
}

// After the last chat on a folder closes, its watchers go too. Later rather
// than at once, so a reconnect doesn't close and reopen them.
export function releaseUnwatchedSoon(delayMs = 30_000): void {
  const w = watch();
  if (w.sweep) return;
  w.sweep = setTimeout(() => {
    w.sweep = undefined;
    const open = new Set(watchedSessions().map(capsKey));
    w.watcher.keys().forEach((k) => open.has(k) || w.watcher.release(k));
  }, delayMs);
  w.sweep.unref?.();
}

// Sends what the agent offers to one watcher, loading it if needed.
export async function sendCapabilities(
  sessionId: string,
  listener: Listener
): Promise<void> {
  let session: Session;
  try {
    // Gone since the socket opened: nothing to say, and nothing to throw.
    session = getSession(sessionId);
  } catch {
    return;
  }
  if (session.host_id && session.host_id !== "local") return;
  try {
    await loadCapabilities(session);
  } catch (error) {
    console.error("Could not load chat commands:", error);
  }
  emitCapabilities(session, listener);
}

// Switches the model now if a conversation is live, and for every next start.
export async function setChatModel(
  sessionId: string,
  model: string
): Promise<void> {
  const value = model.trim();
  if (!value) return;
  db.prepare(`UPDATE sessions SET model = ? WHERE id = ?`).run(
    value,
    sessionId
  );
  registry.live
    .get(sessionId)
    ?.worker.command({ type: "set_model", model: value });
  emitCapabilities(getSession(sessionId));
}

// Changes what the agent may do without asking, now and for every next start.
export async function setChatAccess(
  sessionId: string,
  access: ChatAccess
): Promise<void> {
  if (!CHAT_ACCESS.includes(access)) return;
  // An orchestrator's access is fixed by its role.
  if (getSession(sessionId).role === "orchestrator") return;
  db.prepare(`UPDATE sessions SET chat_access = ? WHERE id = ?`).run(
    access,
    sessionId
  );
  registry.live.get(sessionId)?.worker.command({ type: "set_access", access });
  emitCapabilities(getSession(sessionId));
}

// An orchestrator's permission mode is fixed by its role.
const canPlan = (s: Session) =>
  s.role !== "orchestrator" && chatDriverFor(s.agent_type)?.plan !== false;

// Plan mode: the agent reads and plans, and changes nothing until the plan
// is carried out. Now if a conversation is live, and for every next start.
export async function setChatPlan(
  sessionId: string,
  plan: boolean
): Promise<void> {
  if (!canPlan(getSession(sessionId))) return;
  const live = registry.live.get(sessionId);
  if (live && !live.canPlan) {
    // A worker from an older build would drop the switch: it's retired when
    // its turn ends, and the next one starts in the saved mode.
    emitCapabilities(getSession(sessionId));
    if (live.state === "running" || live.state === "waiting")
      throw new Error(
        "Plan mode can change once this turn ends: the agent is still on the previous build"
      );
    registry.live.delete(sessionId);
    live.worker.command({ type: "close" });
    live.worker.detach();
  }
  db.prepare(`UPDATE sessions SET chat_plan = ? WHERE id = ?`).run(
    plan ? 1 : 0,
    sessionId
  );
  registry.live.get(sessionId)?.worker.command({ type: "set_plan", plan });
  emitCapabilities(getSession(sessionId));
}
