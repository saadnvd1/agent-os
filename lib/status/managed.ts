import type { AgentType } from "@/lib/providers";

export interface ManagedPane {
  name: string;
  hostId: string;
  id: string;
  agentType: AgentType | null;
}

// Which tmux sessions are AgentOS's, and whose. A session renamed in the UI
// renames its tmux session too, so the database's tmux_name is the truth;
// `{provider}-{uuid}` names still count for sessions the database doesn't
// list (yet).
// A row matches a tmux session on its own machine only.
export function managedPanes(
  tmux: { name: string; hostId: string }[],
  rows: {
    id: string;
    tmux_name: string | null;
    agent_type: string | null;
    host_id?: string | null;
  }[],
  isManagedName: (name: string) => boolean,
  idFromName: (name: string) => string
): ManagedPane[] {
  const key = (hostId: string | null | undefined, name: string) =>
    `${hostId || "local"}\t${name}`;
  const byTmux = new Map(
    rows
      .filter((r) => r.tmux_name)
      .map((r) => [key(r.host_id, r.tmux_name as string), r])
  );
  const out: ManagedPane[] = [];
  for (const { name, hostId } of tmux) {
    const row = byTmux.get(key(hostId, name));
    if (row)
      out.push({
        name,
        hostId,
        id: row.id,
        agentType: (row.agent_type as AgentType | null) ?? null,
      });
    else if (isManagedName(name))
      out.push({ name, hostId, id: idFromName(name), agentType: null });
  }
  return out;
}
