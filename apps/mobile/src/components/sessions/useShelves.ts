import { useMemo } from "react";
import type { Session } from "@/lib/db/types";
import {
  buildShelves,
  inWorkspace,
  type SidebarRow,
} from "@/lib/sidebar/shelves";
import { useFilters } from "~/lib/sessions/filters";
import {
  useProjects,
  useSessions,
  useTaskStates,
} from "~/lib/sessions/queries";
import { useStatuses } from "~/lib/sessions/status";
import { useActiveMachine } from "~/lib/machines/store";

export interface Shelf {
  key: "pinned" | "needsYou" | "working" | "done";
  title: string;
  data: SidebarRow[];
}

const TITLES: Record<Shelf["key"], string> = {
  pinned: "Pinned",
  needsYou: "Needs you",
  working: "Working",
  done: "Done",
};

// The web sidebar's shelves for the active machine, filtered the same way.
export function useShelves(query: string, doneLimit: number) {
  const machine = useActiveMachine();
  const sessions = useSessions(machine);
  const projects = useProjects(machine);
  const tasks = useTaskStates(machine);
  const { statuses, live } = useStatuses(machine);
  const filters = useFilters(machine?.id);

  const projectNames = useMemo(
    () => new Map((projects.data ?? []).map((p) => [p.id, p.name])),
    [projects.data]
  );

  const shelves = useMemo(() => {
    const workspaceOf = (id: string) =>
      projects.data?.find((p) => p.id === id)?.workspace_id ?? null;
    const visible = (sessions.data ?? []).filter((s) =>
      inWorkspace(s, workspaceOf, filters.workspaceId)
    );
    const built = buildShelves({
      sessions: visible,
      statuses,
      tasks: tasks.data ?? {},
      projectName: (s: Session) => projectNames.get(s.project_id ?? "") ?? "",
      query,
      projectId: filters.projectId,
    });
    const order: Shelf["key"][] = ["pinned", "needsYou", "working", "done"];
    return order
      .map((key) => ({
        key,
        title: TITLES[key],
        data: key === "done" ? built.done.slice(0, doneLimit) : built[key],
        total: built[key].length,
      }))
      .filter((s) => s.total > 0);
  }, [
    sessions.data,
    projects.data,
    tasks.data,
    statuses,
    projectNames,
    filters,
    query,
    doneLimit,
  ]);

  return { machine, sessions, shelves, projectNames, live, filters };
}
