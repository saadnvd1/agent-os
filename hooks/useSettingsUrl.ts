"use client";

import { useEffect } from "react";
import { subscribe } from "valtio";
import { hrefWithSettings, settingsFromHref } from "@/lib/settings-url";
import { settingsUi, settingsUiActions } from "@/stores/settingsUi";

function fromAddress() {
  const at = settingsFromHref(window.location.href);
  if (at.open) settingsUiActions.open(at.section);
  else if (settingsUi.open) settingsUiActions.close();
}

/**
 * `?settings=<section>` opens Settings at that section, on load and on
 * back/forward, and the address follows Settings as it opens, moves and
 * closes. It replaces the entry rather than pushing one, so Back still
 * leaves the page or goes to the last session.
 */
export function useSettingsUrl() {
  useEffect(() => {
    fromAddress();
    const unsubscribe = subscribe(settingsUi, () => {
      const href = window.location.href;
      const next = hrefWithSettings(href, {
        open: settingsUi.open,
        section: settingsUi.section,
      });
      const url = new URL(href);
      if (next !== url.pathname + url.search + url.hash)
        window.history.replaceState(window.history.state, "", next);
    });
    window.addEventListener("popstate", fromAddress);
    return () => {
      unsubscribe();
      window.removeEventListener("popstate", fromAddress);
    };
  }, []);
}
