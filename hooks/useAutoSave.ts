"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { settingsUi } from "@/stores/settingsUi";

export type SaveStatus = "idle" | "saving" | "saved" | "undo";

const SAVED_MS = 1800;
const UNDO_MS = 7000;

export interface AutoSave<T> {
  // What to show: the value in flight while saving, else the saved one. A
  // rejected save drops the in-flight value, so this is the saved one again.
  value: T;
  status: SaveStatus;
  // Why the last save was rejected; cleared by the next commit. Shown on the
  // row while Settings is open (a toast would sit over the dialog).
  error: string | null;
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
  notify,
}: {
  saved: T;
  save: (next: T) => Promise<unknown>;
  equals?: (a: T, b: T) => boolean;
  notify?: (message: string) => void;
}): AutoSave<T> {
  const [pending, setPending] = useState<{ value: T } | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
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
      setError(null);
      setStatus("saving");
      try {
        await latest.current.save(next);
      } catch (err) {
        if (mine === seq.current) {
          setPending(null);
          setStatus("idle");
        }
        const message = err instanceof Error ? err.message : "Couldn't save";
        if (latest.current.notify) latest.current.notify(message);
        else if (settingsUi.open) setError(message);
        else toast.error(message);
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

  return {
    value: pending ? pending.value : saved,
    status,
    error,
    commit,
    undo,
  };
}
