// Which sessions' status inputs changed since the last pass, so a pass
// recomputes those and reuses the rest (lib/status/incremental.ts). Marked
// from the places that write them. No imports, so any module can call it.
//
// Shared by the custom server and the Next.js route bundles.
interface Dirty {
  all: boolean;
  // A session's id and the time before which it stays marked.
  ids: Map<string, number>;
}

const g = globalThis as unknown as { __agentosStatusDirty?: Dirty };
const dirty: Dirty = (g.__agentosStatusDirty ??= {
  all: false,
  ids: new Map(),
});

/**
 * `id`'s inputs changed. With `settleMs` it stays marked, so every pass
 * recomputes it, until a pass at or after that time: a write still on its
 * way (a worker's buffered chat items) can't be cached half-seen.
 */
export function markStatusDirty(id: string, settleMs = 0): void {
  const until = Date.now() + settleMs;
  dirty.ids.set(id, Math.max(dirty.ids.get(id) ?? 0, until));
}

/** Something every session's status may depend on changed. */
export function markAllStatusDirty(): void {
  dirty.all = true;
}

/** What a pass starting at `now` recomputes; the marks it settles are cleared. */
export function takeDirty(now = Date.now()): {
  all: boolean;
  ids: Set<string>;
} {
  const taken = { all: dirty.all, ids: new Set(dirty.ids.keys()) };
  dirty.all = false;
  for (const [id, until] of dirty.ids) if (until <= now) dirty.ids.delete(id);
  return taken;
}
