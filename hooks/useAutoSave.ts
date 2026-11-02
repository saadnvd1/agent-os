"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type SaveStatus = "idle" | "saving" | "saved" | "undo";

const SAVED_MS = 1800;
const UNDO_MS = 7000;

export interface AutoSave<T> {
  // What to show: the value in flight while saving, else the saved one. A
  // rejected save drops the in-flight value, so this is the saved one again.
  value: T;
  status: SaveStatus;
  // Commit a new value. `undoable` keeps the previous one for Undo (large or
  // destructive changes). Resolves false when the server rejected it.
  commit: (next: T, opts?: { undoable?: boolean }) => Promise<boolean>;
  undo: () => Promise<boolean>;
}

/**
 * Save a setting the moment it changes. `saved` is the server's value
 * (the query's); `save` sends one value and throws to reject it.
 */
export function useAutoSave<T>({
  saved,
  save,
  equals = Object.is,
  notify = (message) => toast.error(message),
}: {
  saved: T;
  save: (next: T) => Promise<unknown>;
  equals?: (a: T, b: T) => boolean;
  notify?: (message: string) => void;
}): AutoSave<T> {
  const [pending, setPending] = useState<{ value: T } | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const previous = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);
  const latest = useRef({ saved, save, equals, notify });
  useEffect(() => {
    latest.current = { saved, save, equals, notify };
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const settle = useCallback((next: SaveStatus, ms: number) => {
    setStatus(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), ms);
  }, []);

  const run = useCallback(
    async (next: T, undoable: boolean, before: T) => {
      const mine = ++seq.current;
      clearTimeout(timer.current);
      setPending({ value: next });
      setStatus("saving");
      try {
        await latest.current.save(next);
      } catch (err) {
        if (mine === seq.current) {
          setPending(null);
          setStatus("idle");
        }
        latest.current.notify(
          err instanceof Error ? err.message : "Couldn't save"
        );
        return false;
      }
      if (mine !== seq.current) return true;
      setPending(null);
      previous.current = undoable ? { value: before } : null;
      settle(undoable ? "undo" : "saved", undoable ? UNDO_MS : SAVED_MS);
      return true;
    },
    [settle]
  );

  const commit = useCallback(
    (next: T, opts?: { undoable?: boolean }) => {
      const { saved: current, equals: same } = latest.current;
      if (same(next, current)) return Promise.resolve(true);
      return run(next, !!opts?.undoable, current);
    },
    [run]
  );

  const undo = useCallback(async () => {
    const back = previous.current;
    if (!back) return false;
    previous.current = null;
    return run(back.value, false, latest.current.saved);
  }, [run]);

  return { value: pending ? pending.value : saved, status, commit, undo };
}
