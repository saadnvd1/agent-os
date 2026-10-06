import { proxy } from "valtio";
import type { AgentType } from "@/lib/providers";

// A one-tap "start a session in this project", raised by the sidebar and
// handled by the page, which owns attaching.
export interface QuickStartRequest {
  projectId: string;
  workingDirectory: string;
  agentType: AgentType;
  timestamp: number;
}

export const quickStartStore = proxy<{ request: QuickStartRequest | null }>({
  request: null,
});

export const quickStartActions = {
  request: (r: Omit<QuickStartRequest, "timestamp">) => {
    quickStartStore.request = { ...r, timestamp: Date.now() };
  },
  clear: () => {
    quickStartStore.request = null;
  },
};
