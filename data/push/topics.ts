import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { sessionKeys } from "../sessions/keys";
import { taskKeys } from "../tasks/keys";
import { projectKeys } from "../projects/keys";
import { hostKeys } from "../hosts/keys";
import { gitKeys } from "../git/keys";
import { devServerKeys } from "../dev-servers/keys";
import { busKeys } from "../bus";
import { stackKeys } from "../stacks";
import { orchestratorKeys } from "../orchestrators";
import { workspaceKeys } from "../workspaces";
import { scheduleKeys } from "../schedules";
import { archivedKeys } from "../done";

// What each pushed topic (a table that changed, lib/db/changes.ts, or a
// pushed view) means the browser should refetch. Only queries on screen
// refetch; the rest are marked stale for next time.
function keysFor(topic: string): QueryKey[] {
  if (topic.startsWith("git:")) {
    const dir = topic.slice(4);
    return [gitKeys.status(dir), [...gitKeys.all, "multi-status"]];
  }
  switch (topic) {
    case "sessions":
      return [
        sessionKeys.all,
        taskKeys.list(),
        orchestratorKeys.all,
        archivedKeys.all,
        busKeys.peers(),
      ];
    case "projects":
      return [projectKeys.all, sessionKeys.all];
    case "groups":
      return [sessionKeys.all];
    case "workspaces":
      return [workspaceKeys.all, orchestratorKeys.all];
    case "hosts":
      return [hostKeys.list()];
    case "discovered":
      return [hostKeys.discovered()];
    case "stacks":
    case "stack_items":
      return [stackKeys.all];
    case "bus_messages":
      return [busKeys.messages()];
    case "schedules":
    case "schedule_runs":
      return [scheduleKeys.all];
    case "orchestrator_asks":
      return [orchestratorKeys.all];
    case "dev_servers":
      return [devServerKeys.all];
    default:
      return [];
  }
}

// `fetchedBefore`: only queries whose data is older than that time.
export function invalidateTopics(
  queryClient: QueryClient,
  topics: readonly string[],
  fetchedBefore?: number
): void {
  const seen = new Set<string>();
  for (const topic of topics)
    for (const queryKey of keysFor(topic)) {
      const id = JSON.stringify(queryKey);
      if (seen.has(id)) continue;
      seen.add(id);
      void queryClient.invalidateQueries({
        queryKey,
        ...(fetchedBefore !== undefined && {
          predicate: (q) => q.state.dataUpdatedAt < fetchedBefore,
        }),
      });
    }
}

// Every pushed topic but git folders: after a gap the stream can't replay.
export const ALL_TOPICS = [
  "sessions",
  "projects",
  "workspaces",
  "hosts",
  "discovered",
  "stacks",
  "bus_messages",
  "schedules",
  "orchestrator_asks",
  "dev_servers",
];

export { keysFor as topicKeys };
