import type { Migration } from "../migration-types";
import { createConversationSearch } from "../../search/conversations/schema";

export default {
  key: "20261019T1500_conversation_search",
  up: (db) => {
    // The index and the triggers that keep it current. Existing chats are
    // indexed in the background after startup (lib/search/conversations/backfill.ts),
    // never in this migration, so a big database doesn't hold up the boot.
    createConversationSearch(db);
  },
} satisfies Migration;
