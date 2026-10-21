"use client";

import { createContext, useContext } from "react";

// The message a rendered block belongs to, for blocks that act on it (a
// review card finds its stored recommendation by the item's id).
export interface ChatItemRef {
  itemId: string;
  streaming: boolean;
}

export const ChatItemContext = createContext<ChatItemRef | null>(null);

export const useChatItem = () => useContext(ChatItemContext);
