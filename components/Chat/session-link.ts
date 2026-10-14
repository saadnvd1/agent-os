import type { MouseEvent } from "react";
import { hrefWithSession } from "@/lib/session-url";

// Opens the session through its address, the way a shared link does.
export function openSessionLink(e: MouseEvent<HTMLAnchorElement>, id: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  window.history.pushState(null, "", hrefWithSession(location.href, id));
  window.dispatchEvent(new PopStateEvent("popstate"));
}
