import { useTasksQuery } from "@/data/tasks";
import { needsHuman } from "@/lib/tasks/state";

// Its own module, so the toolbar's count doesn't pull the dialog into the
// first load.
export function useTasksNeedingYou(): number {
  const { data: tasks = [] } = useTasksQuery();
  return tasks.filter((t) => needsHuman(t.state)).length;
}
