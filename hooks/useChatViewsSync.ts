import { useEffect } from "react";
import { useChatViews } from "@/data/chat-views";
import { chatPositionsActions } from "@/stores/chatPositions";

/** Hands the server's reading positions to the page; chats wait for them to open where they were left. */
export function useChatViewsSync(): void {
  const { data, isError } = useChatViews();
  useEffect(() => {
    if (data) chatPositionsActions.hydrate(data);
    else if (isError) chatPositionsActions.giveUp();
  }, [data, isError]);
}
