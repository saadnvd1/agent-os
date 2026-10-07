import { useOrchestrators } from "~/lib/asks/queries";
import { useActiveMachine } from "~/lib/machines/store";

// Every open ask on the active machine, newest first, with its workspace.
export function useMachineAsks() {
  const machine = useActiveMachine();
  const query = useOrchestrators(machine);
  const asks = (query.data ?? [])
    .flatMap((o) => o.asks.map((ask) => ({ ask, workspaceId: o.workspaceId })))
    .sort((a, b) => b.ask.createdAt.localeCompare(a.ask.createdAt));
  return { machine, asks, count: asks.length, query };
}
