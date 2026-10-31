import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSnapshot } from "valtio";
import { machinesUi, machinesUiActions } from "@/stores/machines";
import type { HostCatalogResponse } from "@/lib/machines/types";
import type { BrowserMachine } from "@/lib/machines/browser";
import { machineKeys } from "./keys";

/**
 * The agents and models a machine reports, for the new-session form; with a
 * project, also what that project last ran with.
 */
export function useMachineCatalog(
  hostId: string,
  projectId: string | null = null
) {
  return useQuery({
    queryKey: machineKeys.agents(hostId, projectId),
    queryFn: async () => {
      const query = projectId
        ? `?project=${encodeURIComponent(projectId)}`
        : "";
      const res = await fetch(
        `/api/hosts/${encodeURIComponent(hostId)}/agents${query}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't list its agents");
      return data as HostCatalogResponse;
    },
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * The machine this browser is on: what the person set, else what the server
 * could tell from the connection, else unknown.
 */
export function useBrowserMachine(): {
  hostId: string | null;
  detected: BrowserMachine["how"];
  set: (hostId: string | null) => void;
} {
  const snap = useSnapshot(machinesUi);
  useEffect(() => {
    machinesUiActions.hydrate();
  }, []);
  const { data } = useQuery({
    queryKey: machineKeys.browser(),
    queryFn: async () => {
      const res = await fetch("/api/machine/browser");
      if (!res.ok) throw new Error("Couldn't tell");
      return (await res.json()) as BrowserMachine;
    },
    staleTime: Infinity,
    retry: false,
  });
  return {
    hostId: snap.browserHostId ?? data?.hostId ?? null,
    detected: data?.how ?? null,
    set: machinesUiActions.setBrowserHost,
  };
}
