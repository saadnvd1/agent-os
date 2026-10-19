"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useUnarchiveSession } from "@/data/done";
import type { ConversationGroup, ConversationHit } from "@/data/search";
import { openChatAt } from "@/stores/chatJump";
import { paletteActions } from "@/stores/palette";

// Closes the palette and takes the reader to the message. An archived chat
// only opens from the sidebar, so it comes back first (as a bookmark's does).
export function useOpenHit() {
  const { mutateAsync: unarchive } = useUnarchiveSession();
  return useCallback(
    (group: ConversationGroup, hit: ConversationHit) => {
      paletteActions.setOpen(false);
      // After the dialog lets go of focus, so the chat can take it.
      const go = () =>
        setTimeout(() => openChatAt(group.sessionId, hit.itemId), 0);
      if (group.status !== "archived") return go();
      unarchive(group.sessionId)
        .then(() => {
          toast.success(`${group.name} is back`);
          go();
        })
        .catch((err: Error) => toast.error(err.message));
    },
    [unarchive]
  );
}
