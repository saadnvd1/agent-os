"use client";

import { SettingBlock } from "@/components/Settings/SettingRow";
import { TextSetting } from "@/components/Settings/settings-fields";
import { useSetWorkspaceHq, useWorkspaceHqQuery } from "@/data/session-logs";

// The git repo this workspace's session logs are written into and
// committed to. Blank keeps them in AgentOS's own folder. The server checks
// the folder exists and is a fit repo before anything is saved; a refusal
// shows as a toast and the field goes back to the saved folder.
export function HqFolderForm({ workspaceId }: { workspaceId: string }) {
  const { data, isPending, isError, error } = useWorkspaceHqQuery(workspaceId);
  const save = useSetWorkspaceHq(workspaceId);

  if (isPending)
    return <div className="bg-muted/60 m-3 h-11 animate-pulse rounded-md" />;
  if (isError)
    return (
      <SettingBlock id={`hq-folder-${workspaceId}`} label="HQ folder">
        <p className="text-destructive text-xs">{error.message}</p>
      </SettingBlock>
    );

  return (
    <TextSetting
      id={`hq-folder-${workspaceId}`}
      label="HQ folder"
      help={`Session logs go to docs/sessions/<project>/ in this repo, one commit per file. ${
        data.hq?.visibility === "private"
          ? "The repo is private, so each commit is pushed."
          : data.hq
            ? "Commits stay local: the repo isn't a private GitHub repository."
            : "It must be a private git repo outside the workspace's projects."
      }`}
      placeholder="~/path/to/a/private/git/repo"
      value={data.hq?.folder ?? ""}
      onSave={(folder) => save.mutateAsync(folder)}
    />
  );
}
