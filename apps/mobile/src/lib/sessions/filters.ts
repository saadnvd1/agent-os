// The sessions list's workspace and project filter, kept per machine.
import * as SecureStore from "expo-secure-store";
import { safeKey } from "~/lib/machines/store";
import { createStore } from "~/lib/store";

export interface Filters {
  workspaceId: string | null;
  projectId: string | null;
}

const NONE: Filters = { workspaceId: null, projectId: null };
const store = createStore<Record<string, Filters>>({});
const key = (machineId: string) => `filters.${safeKey(machineId)}`;

export function useFilters(machineId: string | undefined): Filters {
  const all = store.use();
  return (machineId && all[machineId]) || NONE;
}

export async function loadFilters(machineId: string): Promise<void> {
  if (store.get()[machineId]) return;
  try {
    const raw = await SecureStore.getItemAsync(key(machineId));
    if (raw)
      store.set((s) => ({ ...s, [machineId]: JSON.parse(raw) as Filters }));
  } catch {
    // A filter that can't be read starts empty.
  }
}

export function setFilters(machineId: string, next: Partial<Filters>): void {
  const merged = { ...(store.get()[machineId] ?? NONE), ...next };
  store.set((s) => ({ ...s, [machineId]: merged }));
  SecureStore.setItemAsync(key(machineId), JSON.stringify(merged)).catch(
    () => {}
  );
}
