// What a status pass keeps from the one before, so its cost follows what
// changed and not how many sessions there are:
//  - the session rows, re-read only when `sessions` or `projects` moved
//    (lib/db/changes.ts: every writer is seen) and compared to find the
//    sessions that changed;
//  - per chat and per task, what is worked out from the database, recomputed
//    when its session is marked dirty (lib/status/dirty.ts).
// Every FULL_RECOMPUTE_MS a pass recomputes everything, so an invalidation
// nobody made self-heals.
import { getDb, type Session } from "../db";
import { changeWatcher } from "../db/changes";
import { takeDirty } from "./dirty";

export const FULL_RECOMPUTE_MS = 30_000;

// A session row, and the workspace of its project.
export type SessionRow = Session & { project_workspace_id: string | null };

export interface Pass {
  // Everything is recomputed.
  full: boolean;
  // Sessions whose inputs changed (all of them on a full pass).
  dirty: Set<string>;
  // An orchestrator's asks changed: they and the tasks that read them.
  asksMoved: boolean;
  rows: Map<string, SessionRow>;
}

type Entry<T> = { key: string; value: T };

interface Cache {
  rows: Map<string, { row: SessionRow; json: string }>;
  watch: (() => string[]) | null;
  lastFullAt: number;
  loaded: boolean;
  chats: Map<string, Entry<unknown>>;
  prs: Map<string, Entry<unknown>>;
}

const g = globalThis as unknown as { __agentosStatusCache?: Cache };
const cache: Cache = (g.__agentosStatusCache ??= {
  rows: new Map(),
  watch: null,
  lastFullAt: 0,
  loaded: false,
  chats: new Map(),
  prs: new Map(),
});

/** Forget everything kept: the next pass computes it all. */
export function resetStatusCaches(): void {
  cache.rows.clear();
  cache.chats.clear();
  cache.prs.clear();
  cache.watch = null;
  cache.loaded = false;
  cache.lastFullAt = 0;
}

function loadRows(dirty: Set<string>): void {
  const rows = getDb()
    .prepare(
      `SELECT s.*, p.workspace_id AS project_workspace_id FROM sessions s
         LEFT JOIN projects p ON p.id = s.project_id
        WHERE s.archived_at IS NULL`
    )
    .all() as SessionRow[];
  const before = cache.rows;
  cache.rows = new Map();
  for (const row of rows) {
    const json = JSON.stringify(row);
    if (before.get(row.id)?.json !== json) dirty.add(row.id);
    cache.rows.set(row.id, { row, json });
  }
  for (const id of before.keys())
    if (!cache.rows.has(id)) {
      cache.chats.delete(id);
      cache.prs.delete(id);
    }
}

export function beginPass(now = Date.now(), forceFull = false): Pass {
  // Read before the rows, so a write between the two is seen next time.
  const moved = (cache.watch ??= changeWatcher(getDb))();
  const taken = takeDirty(now);
  const full =
    forceFull ||
    !cache.loaded ||
    taken.all ||
    now - cache.lastFullAt >= FULL_RECOMPUTE_MS;
  const dirty = taken.ids;
  if (full || moved.includes("sessions") || moved.includes("projects")) {
    loadRows(dirty);
    cache.loaded = true;
  }
  if (full) {
    cache.chats.clear();
    cache.prs.clear();
    cache.lastFullAt = now;
  }
  return {
    full,
    dirty,
    asksMoved: moved.includes("orchestrator_asks"),
    rows: new Map([...cache.rows].map(([id, e]) => [id, e.row])),
  };
}

function remembered<T>(
  store: Map<string, Entry<unknown>>,
  id: string,
  stale: boolean,
  key: string,
  compute: () => { value: T; keep: boolean }
): T {
  const kept = store.get(id);
  if (!stale && kept && kept.key === key) return kept.value as T;
  const { value, keep } = compute();
  if (keep) store.set(id, { key, value });
  else store.delete(id);
  return value;
}

/**
 * A chat's database-derived status, from the last pass unless it changed.
 * `key` is what else it was computed from (its state).
 */
export function chatMemo<T>(
  pass: Pass,
  id: string,
  orchestrator: boolean,
  key: string,
  compute: () => T
): T {
  const stale =
    pass.full || pass.dirty.has(id) || (orchestrator && pass.asksMoved);
  return remembered(cache.chats, id, stale, key, () => ({
    value: compute(),
    keep: true,
  }));
}

/** A task's PR stage; `compute` says whether it can be kept (time moves it). */
export function prMemo<T>(
  pass: Pass,
  id: string,
  compute: () => { value: T; keep: boolean }
): T {
  const stale = pass.full || pass.dirty.has(id) || pass.asksMoved;
  return remembered(cache.prs, id, stale, "", compute);
}
