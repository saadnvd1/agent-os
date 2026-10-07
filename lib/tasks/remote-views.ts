/**
 * How tasks on other machines look here: each mirror's view as its machine
 * reports it. A mirror follows the machine's word: finished when it says
 * finished, moved when it says moved, never because it went missing once.
 */

import type { Session } from "../db";
import { requireHostLink, type HostLink } from "../hosts/remote-api";
import { deriveTaskState, type TaskStatus } from "./state";
import { hostTasks, setMirrorStatus } from "./remote";
import type { TaskView } from "./index";

const FINISHED: Record<string, TaskStatus> = {
  merged: "merged",
  dropped: "dropped",
  done: "done",
};

function offlineView(
  session: Session,
  hostName: string,
  error: string
): TaskView {
  return {
    id: session.id,
    name: session.name,
    prompt: session.task_prompt || "",
    projectId: session.project_id,
    projectName: null,
    branch: session.branch_name,
    baseBranch: session.base_branch,
    tmuxName: session.tmux_name,
    state: deriveTaskState({
      taskStatus: session.task_status ?? "running",
      sessionStatus: undefined,
      pr: null,
      blocked: false,
    }),
    pr: null,
    blocked: null,
    cardUrl: null,
    setup: null,
    createdAt: session.created_at,
    hostId: session.host_id,
    hostName,
    hostError: error,
  };
}

async function viewsOn(hostId: string, rows: Session[]): Promise<TaskView[]> {
  let link: HostLink;
  try {
    link = requireHostLink(hostId);
  } catch (err) {
    return rows.map((s) => offlineView(s, "", (err as Error).message));
  }
  try {
    const { tasks, moved = [] } = await hostTasks(link);
    const live = new Map(tasks.map((t) => [t.id, t]));
    const gone = new Set(moved.map((m) => m.id));
    return rows.flatMap((s): TaskView[] => {
      const t = live.get(s.id);
      if (!t) {
        if (gone.has(s.id)) return (setMirrorStatus(s.id, "moved"), []);
        return [
          offlineView(
            s,
            link.hostName,
            `Not in ${link.hostName}'s task list right now`
          ),
        ];
      }
      if (FINISHED[t.state]) setMirrorStatus(s.id, FINISHED[t.state]);
      return [
        {
          ...t,
          projectId: s.project_id,
          hostId,
          hostName: link.hostName,
          hostError: null,
        },
      ];
    });
  } catch (err) {
    return rows.map((s) =>
      offlineView(s, link.hostName, (err as Error).message)
    );
  }
}

export async function remoteTaskViews(mirrors: Session[]): Promise<TaskView[]> {
  const byHost = new Map<string, Session[]>();
  for (const s of mirrors)
    byHost.set(s.host_id, [...(byHost.get(s.host_id) ?? []), s]);
  const views = await Promise.all(
    [...byHost].map(([hostId, rows]) => viewsOn(hostId, rows))
  );
  return views.flat();
}
