// For tests that wait on async work or stand in for file watching.

import fs from "fs";
import { vi } from "vitest";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Polls until `check` holds. The ceiling is generous: it only matters when
// something is really broken, and a loaded machine never reaches it.
export async function until(check: () => boolean, ceilingMs = 10_000) {
  const end = Date.now() + ceilingMs;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition never held");
    await sleep(10);
  }
}

export interface FakeWatch {
  path: string;
  recursive: boolean;
  closed: boolean;
  // Delivers an event as the OS would (null: no file name given).
  fire(name: string | null): void;
}

// Replaces fs.watch with handles the test fires by hand: the OS's own events
// arrive when it likes, which under load is never inside a test's wait.
export function fakeFsWatch() {
  const handles: FakeWatch[] = [];
  const spy = vi.spyOn(fs, "watch").mockImplementation(((
    p: unknown,
    o: unknown,
    listener: (e: string, name: string | null) => void
  ) => {
    const h: FakeWatch = {
      path: String(p),
      recursive: !!(o as { recursive?: boolean } | null)?.recursive,
      closed: false,
      fire: (name) => listener("rename", name),
    };
    handles.push(h);
    return {
      on() {},
      close() {
        h.closed = true;
      },
    };
  }) as unknown as typeof fs.watch);
  return {
    all: handles,
    open: () => handles.filter((h) => !h.closed),
    // The live handle on `p`.
    at(p: string, recursive?: boolean) {
      return handles.find(
        (h) =>
          !h.closed &&
          h.path === p &&
          (recursive === undefined || h.recursive === recursive)
      );
    },
    restore: () => spy.mockRestore(),
  };
}
