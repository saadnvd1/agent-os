"use client";

import { createContext, useContext } from "react";

// Whether the chat can take an undo or carry out a plan (no turn running,
// connected). A context rather than a prop, so a turn starting or ending
// re-renders those buttons and not every row of a long conversation.
export const ChatIdle = createContext(true);
export const useChatIdle = () => useContext(ChatIdle);
