"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import type { Session } from "@/lib/db";
import { SessionUrlSync, locateSession } from "@/lib/session-url";
import { usePanes } from "@/contexts/PaneContext";

interface Options {
  sessions: Session[];
  loaded: boolean;
  reloadSessions: () => Promise<Session[]>;
  /** Shows a session in the focused pane (what picking one in the list does). */
  attachToSession: (session: Session) => void;
  isMobile: boolean;
}

/**
 * The address bar names the focused session (`/?session=<id>`), and an
 * address opens its session: on load, after pairing, and on back/forward.
 * With split panes it follows the focused pane.
 */
export function useSessionUrl({
  sessions,
  loaded,
  reloadSessions,
  attachToSession,
  isMobile,
}: Options) {
  const { state, hydrated, focusedPaneId, focusPane, switchTab, getActiveTab } =
    usePanes();

  // The sync object lives for the page; it reads the latest of everything.
  const latest = useRef({
    sessions,
    state,
    focusedPaneId,
    isMobile,
    attachToSession,
    reloadSessions,
    focusPane,
    switchTab,
  });
  useLayoutEffect(() => {
    latest.current = {
      sessions,
      state,
      focusedPaneId,
      isMobile,
      attachToSession,
      reloadSessions,
      focusPane,
      switchTab,
    };
  });

  // Made on first use, outside render.
  const syncRef = useRef<SessionUrlSync | null>(null);
  const getSync = useCallback(() => {
    if (syncRef.current) return syncRef.current;
    const reveal = (session: Session) => {
      const l = latest.current;
      // An open tab already showing it is focused rather than duplicated; a
      // phone shows only the focused pane.
      const found = locateSession(
        l.state,
        session.id,
        l.isMobile ? [l.focusedPaneId] : undefined
      );
      if (!found) return l.attachToSession(session);
      l.focusPane(found.paneId);
      l.switchTab(found.paneId, found.tabId);
    };
    syncRef.current = new SessionUrlSync(
      {
        href: () => window.location.href,
        push: (href) => window.history.pushState(null, "", href),
        replace: (href) => window.history.replaceState(null, "", href),
      },
      {
        isKnown: (id) => latest.current.sessions.some((s) => s.id === id),
        open: (id) => {
          const session = latest.current.sessions.find((s) => s.id === id);
          if (session) reveal(session);
        },
        // Made a moment ago and not in the list yet: ask once more.
        openUnlisted: async (id) => {
          const fresh = await latest.current.reloadSessions();
          const session = fresh.find((s) => s.id === id);
          if (session) reveal(session);
          return !!session;
        },
        notFound: () =>
          toast.error("Session not found", {
            description: "It may have been archived or deleted.",
          }),
      }
    );
    return syncRef.current;
  }, []);

  // Only a session the list has counts as shown: a tab left on an archived
  // one shows nothing.
  const tabSessionId = getActiveTab(focusedPaneId)?.sessionId ?? null;
  const focusedId =
    tabSessionId && sessions.some((s) => s.id === tabSessionId)
      ? tabSessionId
      : null;

  useEffect(() => {
    getSync().focusChanged(focusedId);
  }, [getSync, focusedId]);

  const ready = hydrated && loaded;
  useEffect(() => {
    if (ready) void getSync().start();
  }, [getSync, ready]);

  useEffect(() => {
    const onPop = () => void getSync().popstate();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [getSync]);
}
