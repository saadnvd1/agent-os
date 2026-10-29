import type { MouseEvent } from "react";
import {
  hrefWithRef,
  hrefWithSession,
  type SessionRef,
} from "@/lib/session-url";

// Opens a session through its address, the way a shared link does. The
// address it lands on is rewritten to the session's readable one.
export function openSessionById(id: string): void {
  go(hrefWithSession(location.href, { id }));
}

export function openSessionLink(
  e: MouseEvent<HTMLAnchorElement>,
  target: string | SessionRef
) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  if (typeof target === "string") openSessionById(target);
  else go(hrefWithRef(location.href, target));
}

function go(href: string): void {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
