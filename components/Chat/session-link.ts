import type { MouseEvent } from "react";
import { navHistoryActions } from "@/stores/navHistory";
import {
  hrefWithRef,
  hrefWithSession,
  type SessionRef,
} from "@/lib/session-url";

// Opens a session through its address, the way a shared link does. The
// address it lands on is rewritten to the session's readable one.
export function openSessionById(id: string): void {
  go(hrefWithSession(location.href, { id }), id);
}

export function openSessionLink(
  e: MouseEvent<HTMLAnchorElement>,
  target: string | SessionRef
) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  if (typeof target === "string") openSessionById(target);
  else
    go(hrefWithRef(location.href, target), "id" in target ? target.id : null);
}

// A link is a chat switch: it gets a history entry, then opens as an address.
export function go(href: string, sessionId: string | null): void {
  navHistoryActions.push(href, sessionId, "Chat");
  window.dispatchEvent(new PopStateEvent("popstate"));
}
