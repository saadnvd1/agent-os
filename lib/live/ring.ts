import type { ItemFrame } from "./frames";

export const RING_ITEMS = 200;
export const RING_BYTES = 512 * 1024;

const sizeOf = (f: ItemFrame) => Buffer.byteLength(JSON.stringify(f));

/** The last items of a share, already redacted, for guests who join late. */
export class Ring {
  private items = new Map<string, { frame: ItemFrame; size: number }>();
  private bytes = 0;

  upsert(frame: ItemFrame): void {
    const old = this.items.get(frame.id);
    if (old) this.bytes -= old.size;
    const size = sizeOf(frame);
    // Same slot when it already exists, so an upsert doesn't reorder the chat.
    this.items.set(frame.id, { frame, size });
    this.bytes += size;
    while (this.items.size > RING_ITEMS || this.bytes > RING_BYTES) {
      const first = this.items.keys().next().value;
      if (first === undefined) break;
      this.bytes -= this.items.get(first)!.size;
      this.items.delete(first);
    }
  }

  list(): ItemFrame[] {
    return [...this.items.values()].map((v) => v.frame);
  }

  get size() {
    return this.items.size;
  }

  get byteSize() {
    return this.bytes;
  }
}

/** Catch-up frames: at most 200 items and `maxBytes` each, in order. */
export function chunk(
  frames: ItemFrame[],
  maxBytes = 48 * 1024
): ItemFrame[][] {
  const out: ItemFrame[][] = [];
  let cur: ItemFrame[] = [];
  let size = 0;
  for (const f of frames) {
    const n = sizeOf(f);
    if (cur.length && (size + n > maxBytes || cur.length >= RING_ITEMS)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(f);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
