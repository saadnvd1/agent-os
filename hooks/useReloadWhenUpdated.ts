"use client";

import { useEffect, useRef } from "react";
import { isActivePhase, type UpdateView } from "@/lib/updates/banner";

/**
 * Reloads once the update this page watched run has finished and the server
 * is back on the new build. A page that never saw it run doesn't reload.
 */
export function useReloadWhenUpdated(view: UpdateView | undefined) {
  const watched = useRef<string | null>(null);
  const queuedFrom = useRef<string | null>(null);
  const run = view?.run;
  // An Update now that autodeploy took: the page was loaded from the old build.
  const sha = view?.current?.sha;
  useEffect(() => {
    if (!sha) return;
    if (view?.queued) queuedFrom.current = sha;
    else if (queuedFrom.current && queuedFrom.current !== sha)
      window.location.reload();
  }, [view?.queued, sha]);
  useEffect(() => {
    if (!run) return;
    if (isActivePhase(run.phase)) watched.current = run.id;
    // A rollback restarted the server onto the old build: reload onto it too.
    else if (
      (run.phase === "done" || run.phase === "rolled_back") &&
      watched.current === run.id
    )
      window.location.reload();
  }, [run]);
}
