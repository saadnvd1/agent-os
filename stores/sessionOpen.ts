import { proxy } from "valtio";

// "Open this session", from anywhere (a schedule's run history); the page
// owns attaching.
export const sessionOpenStore = proxy<{
  request: { sessionId: string; timestamp: number } | null;
}>({ request: null });

export const sessionOpenActions = {
  request: (sessionId: string) => {
    sessionOpenStore.request = { sessionId, timestamp: Date.now() };
  },
  clear: () => {
    sessionOpenStore.request = null;
  },
};
