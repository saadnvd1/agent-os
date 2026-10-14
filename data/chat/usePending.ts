"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadPending,
  pendingReducer,
  savePending,
  type PendingAction,
  type PendingSend,
} from "@/lib/chat/pending";

const NONE: PendingSend[] = [];

// The composer's sends not yet in the chat (lib/chat/pending), kept in this
// browser per session. `dispatch` and `restore` are stable and read no
// render's state, so the socket's handlers can call them.
export function usePending(sessionId: string, connected: boolean) {
  const [state, setState] = useState({ session: sessionId, list: NONE });
  // Another session's sends never show here, even for the render before
  // its own are restored.
  const pending = state.session === sessionId ? state.list : NONE;
  const ref = useRef<PendingSend[]>(NONE);
  const session = useRef(sessionId);
  const restored = useRef<string | null>(null);
  useEffect(() => {
    session.current = sessionId;
    ref.current = NONE;
  }, [sessionId]);

  const replace = useCallback((list: PendingSend[]) => {
    ref.current = list;
    setState({ session: session.current, list });
  }, []);
  const dispatch = useCallback(
    (action: PendingAction) => {
      const next = pendingReducer(ref.current, action);
      if (next === ref.current) return;
      replace(next);
      savePending(session.current, next);
    },
    [replace]
  );
  // Once per session, as its socket first opens: what an earlier page left
  // mid-send, to be sent again.
  const restore = useCallback(() => {
    if (restored.current === session.current) return;
    restored.current = session.current;
    const now = Date.now();
    replace(
      loadPending(session.current).map((p) =>
        p.status === "failed"
          ? p
          : { ...p, status: "sending" as const, at: now }
      )
    );
  }, [replace]);

  // Timeouts only count while connected: a reconnect sends them again.
  const live = connected && pending.some((p) => p.status !== "failed");
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(
      () => dispatch({ type: "tick", now: Date.now() }),
      1000
    );
    return () => clearInterval(timer);
  }, [live, dispatch]);

  return { pending, pendingRef: ref, dispatch, restore };
}
