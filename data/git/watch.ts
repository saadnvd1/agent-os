import { useEffect } from "react";

// The git folders on screen, so the server polls them for this browser
// (lib/git-poller.ts, told over /ws/status) and pushes changes instead of
// each panel polling on its own.
const counts = new Map<string, number>();
const listeners = new Set<() => void>();

export const watchedGitDirs = () => [...counts.keys()];

export function onWatchedGitDirs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function add(dir: string) {
  counts.set(dir, (counts.get(dir) ?? 0) + 1);
  if (counts.get(dir) === 1) listeners.forEach((fn) => fn());
}

function remove(dir: string) {
  const n = (counts.get(dir) ?? 0) - 1;
  if (n > 0) return void counts.set(dir, n);
  counts.delete(dir);
  listeners.forEach((fn) => fn());
}

/** Keeps these folders polled while the component showing them is mounted. */
export function useWatchGitDirs(dirs: readonly (string | null | undefined)[]) {
  const key = dirs.filter(Boolean).join("\0");
  useEffect(() => {
    const list = key ? key.split("\0") : [];
    list.forEach(add);
    return () => list.forEach(remove);
  }, [key]);
}
