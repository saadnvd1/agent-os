// What each chat access level is called and does, for every client. Synced to
// the native app, so it may only import synced files.
import type { ChatAccess } from "./events";

export const ACCESS_LEVELS: Record<
  ChatAccess,
  { label: string; description: string }
> = {
  ask: {
    label: "Ask first",
    description: "Asks before edits and commands it isn't already allowed",
  },
  edits: {
    label: "Accept edits",
    description: "Edits files on its own, asks before other commands",
  },
  full: {
    label: "Full access",
    description: "Does everything without asking",
  },
};

// The access a new chat starts with when the client doesn't pick one.
export const DEFAULT_NEW_CHAT_ACCESS: ChatAccess = "edits";
