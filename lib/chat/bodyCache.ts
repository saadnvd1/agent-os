import type { ToolBody } from "./events";

// Opened tool output kept in memory, least recently used first out.
export const MAX_LOADED_BODIES = 40;
export const MAX_LOADED_BODY_CHARS = 5_000_000;

export type Bodies = Record<string, ToolBody | null>;

export function bodySize(body: ToolBody | null): number {
  if (!body) return 0;
  const d = body.diff;
  return (
    (body.output?.length ?? 0) +
    (d ? d.path.length + d.before.length + d.after.length : 0)
  );
}

// Object keys keep insertion order, so the first key is the least recently
// used. Puts `id` last, loaded or being opened again.
export function touchBody(bodies: Bodies, id: string): Bodies {
  if (!(id in bodies) || Object.keys(bodies).pop() === id) return bodies;
  const { [id]: body, ...rest } = bodies;
  return { ...rest, [id]: body };
}

// Drops the least recently used bodies until both limits hold. A body on
// screen stays, even when that leaves the cache over a limit.
export function capBodies(
  bodies: Bodies,
  visible: ReadonlySet<string>
): Bodies {
  const ids = Object.keys(bodies);
  let count = ids.length;
  let chars = ids.reduce((n, id) => n + bodySize(bodies[id]), 0);
  if (count <= MAX_LOADED_BODIES && chars <= MAX_LOADED_BODY_CHARS)
    return bodies;
  const drop = new Set<string>();
  for (const id of ids) {
    if (count <= MAX_LOADED_BODIES && chars <= MAX_LOADED_BODY_CHARS) break;
    if (visible.has(id)) continue;
    drop.add(id);
    count--;
    chars -= bodySize(bodies[id]);
  }
  return Object.fromEntries(
    ids.filter((id) => !drop.has(id)).map((id) => [id, bodies[id]])
  );
}

// A body arriving: it is the most recently used.
export function addBody(
  bodies: Bodies,
  id: string,
  body: ToolBody | null,
  visible: ReadonlySet<string>
): Bodies {
  const { [id]: _old, ...rest } = bodies;
  return capBodies({ ...rest, [id]: body }, visible);
}

// Whether an opened tool must ask for its body: deferred, not loaded (never
// was, or evicted), and the socket is up.
export function needsBody(
  deferred: boolean | undefined,
  body: ToolBody | null | undefined,
  connected: boolean
): boolean {
  return !!deferred && body === undefined && connected;
}
