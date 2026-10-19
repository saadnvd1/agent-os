import { hrefWithSession } from "@/lib/session-url";
import { bookmarksUiActions } from "@/stores/bookmarksUi";

// Opens a chat by its address, then takes it to one message (bookmarks and
// search both end here). The chat takes the jump once it is on screen.
export function openChatAt(sessionId: string, itemId: string): void {
  window.history.pushState(null, "", hrefWithSession(location.href, sessionId));
  window.dispatchEvent(new PopStateEvent("popstate"));
  bookmarksUiActions.jump(sessionId, itemId);
}
