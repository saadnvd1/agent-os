"use client";

import { createContext, useContext } from "react";

// The session this chat belongs to, for rows that call its API (a context,
// not a prop through every item).
export const ChatSessionId = createContext<string | null>(null);
export const useChatSessionId = () => useContext(ChatSessionId);
