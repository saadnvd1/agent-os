import { hrefWithSession } from "@/lib/session-url";
import { go } from "@/components/Chat/session-link";
import { bookmarksUiActions } from "@/stores/bookmarksUi";

// Opens a chat by its address, then takes it to one message (bookmarks and
// search both end here). The chat takes the jump once it is on screen.
export function openChatAt(sessionId: string, itemId: string): void {
  go(hrefWithSession(location.href, { id: sessionId }), sessionId);
  bookmarksUiActions.jump(sessionId, itemId);
}
