import type { QueryClient } from "@tanstack/react-query";
import { orchestratorKeys } from "../orchestrators";
import { sessionKeys } from "../sessions/keys";
import { workspaceKeys } from "../workspaces";
import { projectKeys } from "./keys";

// A first project can bring a workspace and its orchestrator with it.
export function invalidateAfterProjectAdd(queryClient: QueryClient) {
  for (const queryKey of [
    projectKeys.list(),
    workspaceKeys.all,
    orchestratorKeys.all,
    sessionKeys.list(),
  ])
    void queryClient.invalidateQueries({ queryKey });
}
