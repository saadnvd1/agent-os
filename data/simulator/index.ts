import { useQuery } from "@tanstack/react-query";
import type { SimulatorStatus } from "@/lib/simulator";
import { simulatorKeys } from "./keys";

export { simulatorKeys };
export type { SimulatorStatus };

const POLL_MS = 10_000;

// A lease being brought up or booted changes under us (idle shutdown, a new
// screenshot); anything else only changes when the agent opens one, which the
// next mount picks up.
export function simulatorPollInterval(
  state: SimulatorStatus["state"] | undefined
): number | false {
  return state === "creating" || state === "starting" || state === "ready"
    ? POLL_MS
    : false;
}

export function useSimulatorStatus(sessionId: string, enabled = true) {
  return useQuery({
    queryKey: simulatorKeys.status(sessionId),
    queryFn: async (): Promise<SimulatorStatus> => {
      const res = await fetch(`/api/sessions/${sessionId}/simulator`);
      if (!res.ok) throw new Error("Could not read the simulator");
      return res.json();
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: (query) => simulatorPollInterval(query.state.data?.state),
  });
}
