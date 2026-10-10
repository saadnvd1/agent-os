// A linked machine's sessions are sessions here. One whose folder maps to
// a project here sits with that project's sessions; the rest are listed
// under their machine ("homelab · 3"), with the same rows. Client-safe.
import type { Session } from "@/lib/db/types";
import { buildShelves, type ShelfInput, type SidebarRow } from "./shelves";

export interface MachineGroup {
  hostId: string;
  name: string;
  rows: SidebarRow[];
}

/** A linked machine's session that no project here holds. */
export function onMachineOnly(
  session: Pick<Session, "host_id" | "project_id" | "role" | "peer_mirror">,
  linked: Record<string, string>
): boolean {
  return (
    !!session.peer_mirror &&
    !!session.host_id &&
    !!linked[session.host_id] &&
    !session.project_id &&
    !session.role
  );
}

/** Per linked machine, its sessions with no project here, in shelf order. */
export function machineGroups(
  input: Omit<ShelfInput, "projectId" | "currentOrchestrators">,
  linked: Record<string, string>
): MachineGroup[] {
  return Object.entries(linked)
    .map(([hostId, name]) => {
      const s = buildShelves({
        ...input,
        sessions: input.sessions.filter(
          (x) => x.host_id === hostId && onMachineOnly(x, linked)
        ),
      });
      return {
        hostId,
        name,
        rows: [...s.pinned, ...s.needsYou, ...s.working, ...s.done],
      };
    })
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
