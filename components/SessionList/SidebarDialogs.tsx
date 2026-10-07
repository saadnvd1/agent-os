"use client";

import { ServerLogsModal } from "@/components/DevServers";
import { ProjectSettingsDialog } from "@/components/Projects";
import { HostsDialog } from "@/components/Hosts";
import { WorkspaceNameDialog } from "@/components/Workspaces";
import { useDevServersQuery } from "@/data/dev-servers";
import type { ProjectWithRepositories } from "@/lib/projects";
import { KillAllConfirm } from "./KillAllConfirm";

export type SidebarDialog =
  | { kind: "killAll" }
  | { kind: "hosts" }
  | { kind: "logs"; serverId: string }
  | { kind: "settings"; project: ProjectWithRepositories }
  | { kind: "renameProject"; project: ProjectWithRepositories };

// Every dialog the sidebar opens, one at a time.
export function SidebarDialogs({
  dialog,
  onClose,
  onRenameProject,
}: {
  dialog: SidebarDialog | null;
  onClose: () => void;
  onRenameProject: (projectId: string, name: string) => void;
}) {
  const { data: devServers = [] } = useDevServersQuery();
  const logsServer =
    dialog?.kind === "logs"
      ? devServers.find((s) => s.id === dialog.serverId)
      : undefined;

  return (
    <>
      {dialog?.kind === "killAll" && (
        <KillAllConfirm onCancel={onClose} onComplete={onClose} />
      )}
      {logsServer && (
        <ServerLogsModal
          serverId={logsServer.id}
          serverName={logsServer.name}
          onClose={onClose}
        />
      )}
      <HostsDialog open={dialog?.kind === "hosts"} onClose={onClose} />
      <ProjectSettingsDialog
        project={dialog?.kind === "settings" ? dialog.project : null}
        open={dialog?.kind === "settings"}
        onClose={onClose}
        onSave={onClose}
      />
      <WorkspaceNameDialog
        open={dialog?.kind === "renameProject"}
        title="Rename project"
        initialName={
          dialog?.kind === "renameProject" ? dialog.project.name : ""
        }
        submitLabel="Rename"
        onSubmit={(name) =>
          dialog?.kind === "renameProject" &&
          onRenameProject(dialog.project.id, name)
        }
        onClose={onClose}
      />
    </>
  );
}
