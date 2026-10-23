import { proxy, subscribe } from "valtio";

const KEY = "agentOS-machines-v1";

// What this browser remembers about machines: which one it is on (when the
// server couldn't tell) and which machine the sidebar is narrowed to.
interface Remembered {
  browserHostId: string | null;
  scopeHostId: string | null;
}

export const machinesUi = proxy<Remembered & { hydrated: boolean }>({
  browserHostId: null,
  scopeHostId: null,
  hydrated: false,
});

export const machinesUiActions = {
  hydrate: () => {
    if (machinesUi.hydrated || typeof window === "undefined") return;
    try {
      const saved = JSON.parse(
        localStorage.getItem(KEY) ?? "{}"
      ) as Partial<Remembered>;
      machinesUi.browserHostId = saved.browserHostId ?? null;
      machinesUi.scopeHostId = saved.scopeHostId ?? null;
    } catch {
      // A bad entry is the same as none.
    }
    machinesUi.hydrated = true;
    subscribe(machinesUi, () => {
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({
            browserHostId: machinesUi.browserHostId,
            scopeHostId: machinesUi.scopeHostId,
          })
        );
      } catch {
        // Private mode: it just won't be remembered.
      }
    });
  },
  setBrowserHost: (hostId: string | null) => {
    machinesUi.browserHostId = hostId;
  },
  setScope: (hostId: string | null) => {
    machinesUi.scopeHostId = hostId;
  },
};
