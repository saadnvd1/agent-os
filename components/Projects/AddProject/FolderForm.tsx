"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ProjectExistsError,
  useInitProject,
  type ExistingProject,
} from "@/data/projects";
import { useWorkspacesQuery } from "@/data/workspaces";
import { FolderBrowser } from "./FolderBrowser";

export function FolderForm({
  hostId,
  workspaceId,
  onDone,
}: {
  hostId: string;
  workspaceId: string | null;
  onDone: (projectId: string) => void;
}) {
  const [path, setPath] = useState("~");
  const init = useInitProject();
  const [existing, setExisting] = useState<ExistingProject | null>(null);
  const add = (moveExisting = false) =>
    init.mutate(
      { hostId, path, workspaceId, moveExisting },
      {
        onSuccess: (p) => onDone(p.id),
        onError: (e) =>
          e instanceof ProjectExistsError && setExisting(e.existing),
      }
    );

  if (existing)
    return (
      <AlreadyAProject
        existing={existing}
        workspaceId={workspaceId}
        pending={init.isPending}
        error={init.error instanceof ProjectExistsError ? null : init.error}
        onMove={() => add(true)}
        onOpen={() => onDone(existing.id)}
        onBack={() => {
          setExisting(null);
          init.reset();
        }}
      />
    );

  return (
    <div className="space-y-3">
      <FolderBrowser hostId={hostId} path={path} onNavigate={setPath} />
      {init.error && (
        <p className="text-destructive text-sm">{init.error.message}</p>
      )}
      <Button
        className="h-11 w-full md:h-9"
        disabled={init.isPending}
        onClick={() => add()}
      >
        {init.isPending ? "Adding…" : "Use this folder"}
      </Button>
    </div>
  );
}

// The folder is a project already: move it into the workspace this adds
// to, or just start in it.
function AlreadyAProject({
  existing,
  workspaceId,
  pending,
  error,
  onMove,
  onOpen,
  onBack,
}: {
  existing: ExistingProject;
  workspaceId: string | null;
  pending: boolean;
  error: Error | null;
  onMove: () => void;
  onOpen: () => void;
  onBack: () => void;
}) {
  const { data: workspaces = [] } = useWorkspacesQuery();
  const nameOf = (id: string | null) =>
    workspaces.find((w) => w.id === id)?.name ?? null;
  const from = nameOf(existing.workspaceId);
  const to = nameOf(workspaceId);
  const canMove = !!to && existing.workspaceId !== workspaceId;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium">{existing.name}</span> is already a
        project, {from ? `in ${from}` : "in no workspace"}.
      </p>
      {error && <p className="text-destructive text-sm">{error.message}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        {canMove && (
          <Button
            className="h-11 flex-1 md:h-9"
            disabled={pending}
            onClick={onMove}
          >
            {pending ? "Moving…" : `Move it to ${to}`}
          </Button>
        )}
        <Button
          variant={canMove ? "outline" : "default"}
          className="h-11 flex-1 md:h-9"
          disabled={pending}
          onClick={onOpen}
        >
          Start a session in it
        </Button>
      </div>
      <button
        type="button"
        onClick={onBack}
        className="text-primary min-h-11 px-1 text-sm md:min-h-8"
      >
        Pick another folder
      </button>
    </div>
  );
}
