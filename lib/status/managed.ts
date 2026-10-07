import type { AgentType } from "@/lib/providers";

export interface ManagedPane {
  name: string;
  id: string;
  agentType: AgentType | null;
}

// Which tmux sessions are AgentOS's, and whose. A session renamed in the UI
// renames its tmux session too, so the database's tmux_name is the truth;
// `{provider}-{uuid}` names still count for sessions the database doesn't
// list (yet).
export function managedPanes(
  tmuxNames: string[],
  rows: { id: string; tmux_name: string | null; agent_type: string | null }[],
  isManagedName: (name: string) => boolean,
  idFromName: (name: string) => string
): ManagedPane[] {
  const byTmux = new Map(
    rows.filter((r) => r.tmux_name).map((r) => [r.tmux_name as string, r])
  );
  const out: ManagedPane[] = [];
  for (const name of tmuxNames) {
    const row = byTmux.get(name);
    if (row)
      out.push({
        name,
        id: row.id,
        agentType: (row.agent_type as AgentType | null) ?? null,
      });
    else if (isManagedName(name))
      out.push({ name, id: idFromName(name), agentType: null });
  }
  return out;
}
