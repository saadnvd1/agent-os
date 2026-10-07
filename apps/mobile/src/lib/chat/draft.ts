// What's typed in each chat's composer, kept while you move around the
// app, and where Quote writes.
import { createContext, useContext } from "react";
import { createStore } from "~/lib/store";

const store = createStore<Record<string, string>>({});

export function useDraft(sessionId: string): [string, (text: string) => void] {
  const all = store.use();
  return [
    all[sessionId] ?? "",
    (text) => store.set((s) => ({ ...s, [sessionId]: text })),
  ];
}

export function appendToDraft(sessionId: string, text: string): void {
  store.set((s) => {
    const cur = s[sessionId] ?? "";
    return {
      ...s,
      [sessionId]:
        cur && !cur.endsWith("\n") ? `${cur}\n\n${text}` : cur + text,
    };
  });
}

// The chat a reply is shown in, so its actions know where to quote into.
export const ChatSession = createContext<string>("");
export const useChatSession = () => useContext(ChatSession);
