// The machines this phone knows, in the keychain. Tokens are kept one per
// key, apart from the list, so the list never carries a secret.
import * as SecureStore from "expo-secure-store";
import { createStore } from "~/lib/store";

export interface Machine {
  id: string;
  name: string;
  // The address in use; endpoints are every address it answers at.
  url: string;
  endpoints?: string[];
  // How it let us in the last time: no token on loopback or the tailnet.
  via?: "loopback" | "tailnet" | "device" | "open";
  token?: string;
  addedAt: number;
}

interface MachinesState {
  ready: boolean;
  machines: Machine[];
  activeId: string | null;
}

const LIST = "machines.v1";
const ACTIVE = "machines.active";
// Keychain keys allow only letters, digits, ".", "-" and "_".
export const safeKey = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, "_");
const tokenKey = (id: string) => `machine.token.${safeKey(id)}`;
const opts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

const store = createStore<MachinesState>({
  ready: false,
  machines: [],
  activeId: null,
});

export const useMachines = store.use;

export function useActiveMachine(): Machine | null {
  const { machines, activeId } = store.use();
  return machines.find((m) => m.id === activeId) ?? machines[0] ?? null;
}

export async function loadMachines(): Promise<void> {
  try {
    const list = JSON.parse(
      (await SecureStore.getItemAsync(LIST, opts)) ?? "[]"
    ) as Omit<Machine, "token">[];
    const machines = await Promise.all(
      list.map(async (m) => ({
        ...m,
        token:
          (await SecureStore.getItemAsync(tokenKey(m.id), opts)) ?? undefined,
      }))
    );
    const activeId = await SecureStore.getItemAsync(ACTIVE, opts);
    store.set({ ready: true, machines, activeId });
  } catch {
    store.set({ ready: true, machines: [], activeId: null });
  }
}

async function persist(state: MachinesState) {
  const list = state.machines.map(({ token: _t, ...rest }) => rest);
  await SecureStore.setItemAsync(LIST, JSON.stringify(list), opts);
  if (state.activeId)
    await SecureStore.setItemAsync(ACTIVE, state.activeId, opts);
  else await SecureStore.deleteItemAsync(ACTIVE, opts);
}

export async function saveMachine(machine: Machine): Promise<void> {
  if (machine.token)
    await SecureStore.setItemAsync(tokenKey(machine.id), machine.token, opts);
  else await SecureStore.deleteItemAsync(tokenKey(machine.id), opts);
  const prev = store.get();
  const others = prev.machines.filter((m) => m.id !== machine.id);
  const next = {
    ...prev,
    machines: [...others, machine],
    activeId: machine.id,
  };
  store.set(next);
  await persist(next);
}

export async function updateMachine(
  id: string,
  patch: Partial<Omit<Machine, "id" | "token">>
): Promise<void> {
  const prev = store.get();
  if (!prev.machines.some((m) => m.id === id)) return;
  const next = {
    ...prev,
    machines: prev.machines.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  };
  store.set(next);
  await persist(next);
}

export const getMachine = (id: string) =>
  store.get().machines.find((m) => m.id === id) ?? null;

export async function removeMachine(id: string): Promise<void> {
  await SecureStore.deleteItemAsync(tokenKey(id), opts);
  const prev = store.get();
  const machines = prev.machines.filter((m) => m.id !== id);
  const activeId =
    prev.activeId === id ? (machines[0]?.id ?? null) : prev.activeId;
  const next = { ...prev, machines, activeId };
  store.set(next);
  await persist(next);
}

export async function setActiveMachine(id: string): Promise<void> {
  const next = { ...store.get(), activeId: id };
  store.set(next);
  await persist(next);
}
