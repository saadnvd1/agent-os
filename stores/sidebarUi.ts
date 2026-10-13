import { proxy, subscribe } from "valtio";

const STORAGE_KEY = "agentOS-sidebar-v2";

// The sidebar's remembered view: which workspace, which project, and
// whether Done is folded. Search and paging reset with the page.
interface Remembered {
  workspaceId: string | null;
  projectId: string | null;
  doneCollapsed: boolean;
  snoozedCollapsed: boolean;
}

export const sidebarUi = proxy<
  Remembered & {
    query: string;
    donePages: number;
    hydrated: boolean;
    // Filter to one orchestrator's work; session-only, resets on reload.
    orchestratorId: string | null;
  }
>({
  workspaceId: null,
  projectId: null,
  doneCollapsed: true,
  snoozedCollapsed: true,
  query: "",
  orchestratorId: null,
  donePages: 0,
  hydrated: false,
});

function read(): Partial<Remembered> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export const sidebarUiActions = {
  hydrate: () => {
    if (sidebarUi.hydrated) return;
    const saved = read();
    sidebarUi.workspaceId = saved.workspaceId ?? null;
    sidebarUi.projectId = saved.projectId ?? null;
    sidebarUi.doneCollapsed = saved.doneCollapsed ?? true;
    sidebarUi.snoozedCollapsed = saved.snoozedCollapsed ?? true;
    sidebarUi.hydrated = true;
    subscribe(sidebarUi, () => {
      try {
        const { workspaceId, projectId, doneCollapsed, snoozedCollapsed } =
          sidebarUi;
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            workspaceId,
            projectId,
            doneCollapsed,
            snoozedCollapsed,
          })
        );
      } catch {
        // Storage can be unavailable (private mode); the view still works.
      }
    });
  },
  setWorkspace: (id: string | null) => {
    sidebarUi.workspaceId = id;
    sidebarUi.projectId = null;
    sidebarUi.orchestratorId = null;
    sidebarUi.donePages = 0;
  },
  setProject: (id: string | null) => {
    sidebarUi.projectId = id;
    sidebarUi.donePages = 0;
  },
  setOrchestrator: (id: string | null) => {
    sidebarUi.orchestratorId = id;
    sidebarUi.donePages = 0;
  },
  setQuery: (query: string) => {
    sidebarUi.query = query;
  },
  toggleDone: () => {
    sidebarUi.doneCollapsed = !sidebarUi.doneCollapsed;
  },
  toggleSnoozed: () => {
    sidebarUi.snoozedCollapsed = !sidebarUi.snoozedCollapsed;
  },
  showMoreDone: () => {
    sidebarUi.donePages += 1;
  },
};
