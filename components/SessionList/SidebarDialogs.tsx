"use client";

import { ServerLogsModal } from "@/components/DevServers";
import { NewProjectDialog, ProjectSettingsDialog } from "@/components/Projects";
import { FolderPicker } from "@/components/FolderPicker";
import { HostsDialog } from "@/components/Hosts";
import { WorkspaceNameDialog } from "@/components/Workspaces";
import { useCreateProject } from "@/data/projects";
import { useDevServersQuery } from "@/data/dev-servers";
import { getDefaultModelForAgent } from "@/lib/model-catalog";
import type { ProjectWithRepositories } from "@/lib/projects";
import { KillAllConfirm } from "./KillAllConfirm";

export type SidebarDialog =
  | { kind: "newProject"; mode: "new" | "clone" }
  | { kind: "openProject" }
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
  const createProject = useCreateProject();
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
      <NewProjectDialog
        open={dialog?.kind === "newProject"}
        mode={dialog?.kind === "newProject" ? dialog.mode : "new"}
        onClose={onClose}
        onCreated={onClose}
      />
      {dialog?.kind === "openProject" && (
        <FolderPicker
          initialPath="~"
          onClose={onClose}
          onSelect={(path) => {
            const parts = path.split("/").filter(Boolean);
            createProject.mutate(
              {
                name: parts[parts.length - 1] || "project",
                workingDirectory: path,
                agentType: "claude",
                defaultModel: getDefaultModelForAgent("claude"),
                devServers: [],
              },
              {
                onSettled: onClose,
                onError: (err) =>
                  console.error("Failed to create project:", err),
              }
            );
          }}
        />
      )}
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
