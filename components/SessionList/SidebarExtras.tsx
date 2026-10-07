"use client";

import { DevServerCard } from "@/components/DevServers/DevServerCard";
import { ElsewhereTmuxList, TmuxSessionRow } from "@/components/Hosts";
import { useDevServersQuery } from "@/data/dev-servers";
import { useDiscoveredTmuxQuery } from "@/data/hosts";
import type { ProjectWithRepositories } from "@/lib/projects";

interface DevServerHandlers {
  onStop: (id: string) => Promise<void>;
  onRestart: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onViewLogs: (id: string) => void;
}

const label =
  "text-muted-foreground/70 px-2.5 pt-3.5 pb-1.5 text-[11px] font-medium tracking-[0.08em] uppercase";

// Under the shelves: dev servers (running ones, or every one of the chosen
// project), tmux sessions agent-os didn't start, then those outside every
// project.
export function SidebarExtras({
  projects,
  project,
  handlers,
}: {
  projects: ProjectWithRepositories[];
  project: ProjectWithRepositories | null;
  handlers: DevServerHandlers;
}) {
  const { data: devServers = [] } = useDevServersQuery();
  const { data: discovered } = useDiscoveredTmuxQuery();
  const inView = new Set((project ? [project] : projects).map((p) => p.id));
  const servers = devServers.filter(
    (s) => inView.has(s.project_id) && (project || s.status === "running")
  );
  const tmux = (discovered?.sessions ?? []).filter(
    (t) => t.projectId && inView.has(t.projectId)
  );

  return (
    <>
      {servers.length > 0 && (
        <section aria-label="Dev servers">
          <div className={label}>Dev servers · {servers.length}</div>
          {servers.map((server) => (
            <DevServerCard
              key={server.id}
              server={server}
              onStart={handlers.onRestart}
              onStop={handlers.onStop}
              onRestart={handlers.onRestart}
              onRemove={handlers.onRemove}
              onViewLogs={handlers.onViewLogs}
            />
          ))}
        </section>
      )}
      {tmux.length > 0 && (
        <section aria-label="Terminals">
          <div className={label}>Terminals · {tmux.length}</div>
          {tmux.map((t) => (
            <TmuxSessionRow key={`${t.hostId}:${t.name}`} session={t} />
          ))}
        </section>
      )}
      {!project && <ElsewhereTmuxList />}
    </>
  );
}
