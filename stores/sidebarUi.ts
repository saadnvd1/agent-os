import { proxy, subscribe } from "valtio";

const STORAGE_KEY = "agentOS-sidebar-v2";

// The sidebar's remembered view: which workspace, which project, and
// whether Done is folded. Search and paging reset with the page.
interface Remembered {
  workspaceId: string | null;
  projectId: string | null;
  doneCollapsed: boolean;
}

export const sidebarUi = proxy<
  Remembered & { query: string; donePages: number; hydrated: boolean }
>({
  workspaceId: null,
  projectId: null,
  doneCollapsed: false,
  query: "",
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
    sidebarUi.doneCollapsed = !!saved.doneCollapsed;
    sidebarUi.hydrated = true;
    subscribe(sidebarUi, () => {
      try {
        const { workspaceId, projectId, doneCollapsed } = sidebarUi;
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ workspaceId, projectId, doneCollapsed })
        );
      } catch {
        // Storage can be unavailable (private mode); the view still works.
      }
    });
  },
  setWorkspace: (id: string | null) => {
    sidebarUi.workspaceId = id;
    sidebarUi.projectId = null;
    sidebarUi.donePages = 0;
  },
  setProject: (id: string | null) => {
    sidebarUi.projectId = id;
    sidebarUi.donePages = 0;
  },
  setQuery: (query: string) => {
    sidebarUi.query = query;
  },
  toggleDone: () => {
    sidebarUi.doneCollapsed = !sidebarUi.doneCollapsed;
  },
  showMoreDone: () => {
    sidebarUi.donePages += 1;
  },
};
