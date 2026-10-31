"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { SEEN_KEY, unreadCount } from "@/lib/whats-new/unread";
import type { Head } from "@/lib/whats-new/schema";

// The newest entry id this browser has seen, in localStorage: per browser,
// no server state. Absent on a new install until the first head arrives, which
// sets it silently so a fresh install has nothing "new".
const listeners = new Set<() => void>();

function read(): number | null {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function write(id: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(id));
  } catch {}
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

export function useWhatsNewSeen(head: Head | undefined) {
  const seen = useSyncExternalStore(subscribe, read, () => null);
  useEffect(() => {
    if (head && read() === null) write(head.latestId);
  }, [head]);
  const markSeen = useCallback(() => {
    if (head) write(head.latestId);
  }, [head]);
  return {
    seen,
    unread: head ? unreadCount(head.recent, seen) : 0,
    markSeen,
  };
}
