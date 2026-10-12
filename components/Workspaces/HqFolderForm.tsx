"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSetWorkspaceHq, useWorkspaceHqQuery } from "@/data/session-logs";

// The git repo this workspace's session logs are written into and
// committed to. Blank keeps them in AgentOS's own folder.
export function HqFolderForm({ workspaceId }: { workspaceId: string }) {
  const { data, isPending, isError, error } = useWorkspaceHqQuery(workspaceId);
  const save = useSetWorkspaceHq(workspaceId);
  const [draft, setDraft] = useState<string | null>(null);
  const saved = data?.hq?.folder ?? "";
  const folder = draft ?? saved;
  const id = `hq-folder-${workspaceId}`;

  if (isPending)
    return <div className="bg-muted/60 h-11 animate-pulse rounded-md" />;
  if (isError)
    return <p className="text-destructive text-xs">{error.message}</p>;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(folder, {
          onSuccess: () => {
            setDraft(null);
            toast.success(
              folder.trim() ? "HQ folder saved" : "HQ folder cleared"
            );
          },
          onError: (err) => toast.error(err.message),
        });
      }}
      className="space-y-1.5"
    >
      <label htmlFor={id} className="text-sm">
        HQ folder
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={folder}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="~/path/to/a/private/git/repo"
          className="h-11 flex-1 text-base md:h-9 md:text-sm"
        />
        <Button
          type="submit"
          size="sm"
          className="h-11 sm:h-9"
          disabled={folder === saved || save.isPending}
        >
          Save
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Session logs go to docs/sessions/&lt;project&gt;/ in this repo and are
        committed there, one file per commit.{" "}
        {data.hq?.visibility === "private"
          ? "The repo is private, so each commit is pushed."
          : data.hq
            ? "Commits stay local: the repo isn't a private GitHub repository."
            : "It must be a private git repo outside the workspace's projects."}
      </p>
    </form>
  );
}
