"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjectsQuery } from "@/data/projects";
import {
  useLinkBoard,
  useUnlinkBoard,
  useWorkspaceBoards,
} from "@/data/lumifyhub";
import { lumifyhubUi, lumifyhubUiActions } from "@/stores/lumifyhubUi";

const CREATE = "__create__";

export function BoardLinkDialog() {
  const { linkBoardProjectId } = useSnapshot(lumifyhubUi);
  const { data: projects = [] } = useProjectsQuery();
  const project = projects.find((p) => p.id === linkBoardProjectId);
  const close = lumifyhubUiActions.closeBoardLink;

  return (
    <Dialog open={!!project} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-md">
        {project && (
          <>
            <DialogHeader>
              <DialogTitle>Board for {project.name}</DialogTitle>
              <DialogDescription>
                Each task gets a card that moves from To Do to Done as it runs.
              </DialogDescription>
            </DialogHeader>
            <BoardPicker
              key={project.id}
              projectId={project.id}
              projectName={project.name}
              workspaceId={project.workspace_id}
              current={project.lh_board_id}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BoardPicker({
  projectId,
  projectName,
  workspaceId,
  current,
}: {
  projectId: string;
  projectName: string;
  workspaceId: string | null;
  current: string | null;
}) {
  const {
    data: boards = [],
    isPending,
    error,
  } = useWorkspaceBoards(workspaceId);
  const link = useLinkBoard();
  const unlink = useUnlinkBoard();
  const [choice, setChoice] = useState(current ?? CREATE);
  const close = lumifyhubUiActions.closeBoardLink;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice === current) return close();
        link.mutate(
          {
            projectId,
            target: choice === CREATE ? { create: true } : { boardId: choice },
          },
          { onSuccess: close }
        );
      }}
    >
      <Select value={choice} onValueChange={setChoice} disabled={isPending}>
        <SelectTrigger aria-label="Board" className="h-11 sm:h-9">
          <SelectValue placeholder="Loading boards..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CREATE}>Create board “{projectName}”</SelectItem>
          {boards.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {(error || link.error) && (
        <p className="text-destructive text-sm">
          {(error || link.error)?.message}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {current ? (
          <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground"
            disabled={unlink.isPending}
            onClick={() => unlink.mutate(projectId, { onSuccess: close })}
          >
            Unlink
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={link.isPending || isPending}>
          {link.isPending
            ? "Linking..."
            : choice === current
              ? "Done"
              : "Link board"}
        </Button>
      </div>
    </form>
  );
}
