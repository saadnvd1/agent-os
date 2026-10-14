import { proxy } from "valtio";
import { INBOX_TABS, type InboxTab } from "@/lib/inbox/counts";

const TAB_KEY = "agentos:inbox-tab";
const SEEN_KEY = "agentos:inbox-messages-seen";

const read = (key: string) => {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice just isn't kept.
  }
};

export const lastInboxTab = (): InboxTab | null => {
  const saved = read(TAB_KEY);
  return INBOX_TABS.find((t) => t === saved) ?? null;
};

// The Inbox panel, shared by the bar, the sidebar menu and the palette.
// `request` is an explicit tab to open on; without one the panel picks.
export const inboxUi = proxy<{
  open: boolean;
  request: InboxTab | null;
  // The newest message he has looked at; null until first seen.
  seenMessageId: number | null;
}>({
  open: false,
  request: null,
  seenMessageId: null,
});

export const inboxUiActions = {
  open: (tab?: InboxTab) => {
    inboxUi.request = tab ?? null;
    inboxUi.open = true;
  },
  setOpen: (open: boolean) => {
    inboxUi.open = open;
  },
  rememberTab: (tab: InboxTab) => write(TAB_KEY, tab),
  loadSeen: () => {
    if (inboxUi.seenMessageId !== null) return;
    const saved = read(SEEN_KEY);
    if (saved !== null && Number.isFinite(Number(saved)))
      inboxUi.seenMessageId = Number(saved);
  },
  markSeen: (id: number) => {
    if (inboxUi.seenMessageId !== null && id <= inboxUi.seenMessageId) return;
    inboxUi.seenMessageId = id;
    write(SEEN_KEY, String(id));
  },
};
