import { expandPath, getGitStatus, type GitStatus } from "./git-status";
import { notifyTopic } from "./status/hub";

/**
 * One git status poller per working directory, shared by every viewer. The
 * folders polled are the ones open browsers say they show (watch_git over
 * /ws/status); each is read every 30s, backing off to 5 minutes while git
 * fails, and right away when a session working in it finishes a run. A
 * change is pushed as `git:<folder as the browser named it>`, and browsers
 * refetch. Reads within a couple of seconds share one git call.
 */

const EVERY_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const SHARE_MS = 2_000;
const TICK_MS = 5_000;
const MAX_DIRS_PER_WATCHER = 50;

interface Entry {
  // How browsers named it ("~/code/app"), for the topic they listen on.
  names: Set<string>;
  last?: string;
  at: number;
  every: number;
  nextAt: number;
  reading?: Promise<GitStatus>;
  // Bumped by a change made here: a read started before it isn't reused.
  generation: number;
  readingGeneration?: number;
}

const g = globalThis as unknown as {
  __agentosGitPoller?: {
    entries: Map<string, Entry>;
    watchers: Map<object, Set<string>>;
    timer: ReturnType<typeof setInterval> | null;
  };
};
const state = (g.__agentosGitPoller ??= {
  entries: new Map(),
  watchers: new Map(),
  timer: null,
});

function entryFor(dir: string): Entry {
  let entry = state.entries.get(dir);
  if (!entry) {
    entry = {
      names: new Set(),
      at: 0,
      every: EVERY_MS,
      nextAt: 0,
      generation: 0,
    };
    state.entries.set(dir, entry);
  }
  return entry;
}

function read(dir: string, entry: Entry): Promise<GitStatus> {
  if (entry.reading && entry.readingGeneration === entry.generation)
    return entry.reading;
  const generation = entry.generation;
  const reading: Promise<GitStatus> = getGitStatus(dir)
    .then((status) => {
      // Started before a change made here: its answer is already old.
      if (generation !== entry.generation) return status;
      const json = JSON.stringify(status);
      const moved = entry.last !== undefined && entry.last !== json;
      entry.last = json;
      entry.at = Date.now();
      entry.every = EVERY_MS;
      entry.nextAt = entry.at + entry.every;
      if (moved) for (const name of entry.names) notifyTopic(`git:${name}`);
      return status;
    })
    .catch((error) => {
      entry.every = Math.min(entry.every * 2, MAX_BACKOFF_MS);
      entry.nextAt = Date.now() + entry.every;
      throw error;
    })
    .finally(() => {
      if (entry.reading === reading) entry.reading = undefined;
    });
  entry.reading = reading;
  entry.readingGeneration = generation;
  return reading;
}

/** A folder's status for a request: shared with reads moments ago. */
export async function sharedGitStatus(dir: string): Promise<GitStatus> {
  const path = expandPath(dir);
  const entry = entryFor(path);
  if (entry.last && Date.now() - entry.at < SHARE_MS)
    return JSON.parse(entry.last) as GitStatus;
  return read(path, entry);
}

/** A change was just made here (a commit, a stage): the next read is fresh. */
export function forgetGitStatus(dir: string): void {
  const entry = state.entries.get(expandPath(dir));
  if (entry) {
    entry.at = 0;
    entry.generation++;
  }
}

/** A run in this folder finished: look again now if anyone shows it. */
export function refreshGitSoon(dir: string): void {
  const entry = state.entries.get(expandPath(dir));
  if (entry?.names.size) entry.nextAt = 0;
}

function sync(): void {
  const wanted = new Map<string, Set<string>>();
  for (const dirs of state.watchers.values())
    for (const name of dirs) {
      const path = expandPath(name);
      if (!wanted.has(path)) wanted.set(path, new Set());
      wanted.get(path)!.add(name);
    }
  for (const [path, entry] of state.entries) {
    entry.names = wanted.get(path) ?? new Set();
    if (!entry.names.size && !entry.reading) state.entries.delete(path);
  }
  for (const [path, names] of wanted) entryFor(path).names = names;
  if (wanted.size && !state.timer) {
    state.timer = setInterval(tick, TICK_MS);
    state.timer.unref?.();
  } else if (!wanted.size && state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function tick(): void {
  const now = Date.now();
  for (const [path, entry] of state.entries)
    if (entry.names.size && now >= entry.nextAt && !entry.reading)
      void read(path, entry).catch(() => {});
}

/** The folders this viewer (a socket) shows now; replaces its last list. */
export function watchGit(watcher: object, dirs: unknown): void {
  const list = Array.isArray(dirs)
    ? dirs
        .filter(
          (d): d is string =>
            typeof d === "string" && d.length > 0 && d.length <= 1024
        )
        .slice(0, MAX_DIRS_PER_WATCHER)
    : [];
  state.watchers.set(watcher, new Set(list));
  sync();
}

export function unwatchGit(watcher: object): void {
  if (state.watchers.delete(watcher)) sync();
}

// For tests: what's polled now.
export function polledDirs(): string[] {
  return [...state.entries]
    .filter(([, e]) => e.names.size)
    .map(([path]) => path);
}
