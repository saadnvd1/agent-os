"use client";

import { useSnapshot } from "valtio";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addProjectActions, addProjectUi } from "@/stores/addProject";
import { newDraft } from "@/stores/drafts";
import { useHostNames } from "@/data/hosts";
import { FolderForm } from "./FolderForm";
import { CloneForm } from "./CloneForm";
import { NameForm } from "./NameForm";

const TITLES = {
  folder: "Open a folder",
  clone: "Clone from a URL",
  name: "New project",
};

// The last step of "Add project" (⌘K): a folder, a clone or a name. Once
// it's made, a draft opens in it.
export function AddProjectDialog() {
  const { open } = useSnapshot(addProjectUi);
  const hostNames = useHostNames();
  const done = (projectId: string) => {
    addProjectActions.close();
    newDraft({ kind: "project", projectId });
  };

  return (
    <Dialog open={!!open} onOpenChange={(o) => !o && addProjectActions.close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{open ? TITLES[open.kind] : ""}</DialogTitle>
          <DialogDescription>
            On{" "}
            {open && open.hostId !== "local"
              ? (hostNames[open.hostId] ?? open.hostId)
              : "this machine"}
          </DialogDescription>
        </DialogHeader>
        {open?.kind === "folder" && (
          <FolderForm hostId={open.hostId} onDone={done} />
        )}
        {open?.kind === "clone" && (
          <CloneForm hostId={open.hostId} onDone={done} />
        )}
        {open?.kind === "name" && (
          <NameForm hostId={open.hostId} onDone={done} />
        )}
      </DialogContent>
    </Dialog>
  );
}
