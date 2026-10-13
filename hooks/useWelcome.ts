"use client";

import { useEffect, useRef } from "react";
import { subscribe } from "valtio";
import { useCompleteWelcome, useWelcomeQuery } from "@/data/welcome";
import { hrefWithWelcome, welcomeFromHref } from "@/lib/welcome-url";
import { newDraft } from "@/stores/drafts";
import { welcomeUi, welcomeUiActions } from "@/stores/welcomeUi";

function fromAddress() {
  const at = welcomeFromHref(window.location.href);
  if (at.open) welcomeUiActions.open(at.step);
  else if (welcomeUi.open) welcomeUiActions.close();
}

/**
 * `?welcome=<step>` opens the first-run welcome at that step, on load and on
 * back/forward; the address follows it. Moving between steps adds a history
 * entry, so Back goes to the step before. A fresh install with setup still to
 * do opens it by itself, once.
 */
export function useWelcomeUrl() {
  const { data: gate } = useWelcomeQuery();
  const asked = useRef(false);

  useEffect(() => {
    fromAddress();
    let was = { open: welcomeUi.open, step: welcomeUi.step };
    const unsubscribe = subscribe(welcomeUi, () => {
      const href = window.location.href;
      const next = hrefWithWelcome(href, {
        open: welcomeUi.open,
        step: welcomeUi.step,
      });
      const url = new URL(href);
      if (next !== url.pathname + url.search + url.hash) {
        const move = was.open && welcomeUi.open && was.step !== welcomeUi.step;
        window.history[move ? "pushState" : "replaceState"](
          window.history.state,
          "",
          next
        );
      }
      was = { open: welcomeUi.open, step: welcomeUi.step };
    });
    window.addEventListener("popstate", fromAddress);
    return () => {
      unsubscribe();
      window.removeEventListener("popstate", fromAddress);
    };
  }, []);

  useEffect(() => {
    if (!gate?.show || asked.current || welcomeUi.open) return;
    asked.current = true;
    welcomeUiActions.open("agents");
  }, [gate?.show]);
}

/** Setup is over, finished or skipped: remember it and close. */
export function useEndWelcome() {
  const { mutate } = useCompleteWelcome();
  return (start?: boolean) => {
    const projectId = welcomeUi.projectId;
    mutate();
    welcomeUiActions.close();
    welcomeUiActions.setProject(null);
    if (start && projectId) newDraft({ kind: "project", projectId });
  };
}
