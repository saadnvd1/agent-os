import { proxy } from "valtio";

// "Open this workspace's orchestrator", raised by the sidebar and handled by
// the page, which owns attaching. The first open makes it.
export const orchestratorOpenStore = proxy<{
  request: { workspaceId: string; timestamp: number } | null;
}>({ request: null });

export const orchestratorOpenActions = {
  request: (workspaceId: string) => {
    orchestratorOpenStore.request = { workspaceId, timestamp: Date.now() };
  },
  clear: () => {
    orchestratorOpenStore.request = null;
  },
};
