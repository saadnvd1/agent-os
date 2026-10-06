import { proxy } from "valtio";

export interface TmuxAttachRequest {
  sessionName: string;
  hostId: string;
  timestamp: number;
}

export const tmuxAttachStore = proxy<{ request: TmuxAttachRequest | null }>({
  request: null,
});

export const tmuxAttachActions = {
  request: (sessionName: string, hostId: string) => {
    tmuxAttachStore.request = { sessionName, hostId, timestamp: Date.now() };
  },
  clear: () => {
    tmuxAttachStore.request = null;
  },
};
