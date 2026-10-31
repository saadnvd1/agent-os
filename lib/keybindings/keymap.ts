// Every shortcut the app has, in one table: the keys that act on it, the
// shortcuts panel and the palette hints all read this. A `keys` string with
// a space is a sequence (press g, then i); without one it is a chord.

export type KeyGroup = "Go to" | "Chats" | "General" | "Browser";

export interface KeyEntry {
  id: string;
  keys: string;
  label: string;
  group: KeyGroup;
  // A bare key or sequence: only while nothing is being typed, and off with
  // the single-key switch.
  single?: boolean;
  // The browser acts on it, not the app: listed so it can be found.
  browser?: boolean;
}

export const KEYMAP: KeyEntry[] = [
  { id: "go.inbox", keys: "g i", label: "Inbox", group: "Go to", single: true },
  {
    id: "go.bookmarks",
    keys: "g b",
    label: "Bookmarks",
    group: "Go to",
    single: true,
  },
  {
    id: "go.messages",
    keys: "g m",
    label: "Messages",
    group: "Go to",
    single: true,
  },
  {
    id: "go.settings",
    keys: "g s",
    label: "Settings",
    group: "Go to",
    single: true,
  },
  {
    id: "chat.previous",
    keys: "g p",
    label: "Previous chat (flip back and forth)",
    group: "Chats",
    single: true,
  },
  {
    id: "chat.open",
    keys: "o c",
    label: "Open a chat",
    group: "Chats",
    single: true,
  },
  {
    id: "chat.new",
    keys: "c",
    label: "New chat",
    group: "Chats",
    single: true,
  },
  { id: "switcher.open", keys: "mod+p", label: "Switch chat", group: "Chats" },
  {
    id: "session.previous",
    keys: "mod+up",
    label: "Chat above in the sidebar",
    group: "Chats",
  },
  {
    id: "session.next",
    keys: "mod+down",
    label: "Chat below in the sidebar",
    group: "Chats",
  },
  {
    id: "palette.open",
    keys: "mod+k",
    label: "Command palette",
    group: "General",
  },
  {
    id: "help.open",
    keys: "?",
    label: "Keyboard shortcuts",
    group: "General",
    single: true,
  },
  {
    id: "history.back",
    keys: "mod+[",
    label: "Back to the chat you came from",
    group: "Browser",
    browser: true,
  },
  {
    id: "history.forward",
    keys: "mod+]",
    label: "Forward",
    group: "Browser",
    browser: true,
  },
];

export const keysOf = (id: string): string => {
  const e = KEYMAP.find((k) => k.id === id);
  if (!e) throw new Error(`No shortcut "${id}"`);
  return e.keys;
};

export const isSequence = (keys: string) => keys.includes(" ");

/** The table's entries a search finds, in table order; no search finds all. */
export function searchKeymap(query: string): KeyEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return KEYMAP;
  return KEYMAP.filter((k) =>
    `${k.label} ${k.keys} ${k.group}`.toLowerCase().includes(q)
  );
}
