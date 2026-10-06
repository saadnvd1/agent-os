"use client";

import { useState } from "react";
import { useSnapshot } from "valtio";
import { ExternalLink, Users } from "lucide-react";
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
import { useWorkspacesQuery } from "@/data/workspaces";
import {
  useLhWorkspaces,
  useLinkWorkspace,
  useLumifyHubStatus,
  useUnlinkWorkspace,
} from "@/data/lumifyhub";
import { workspaceUrl } from "@/lib/lumifyhub/urls";
import { lumifyhubUi, lumifyhubUiActions } from "@/stores/lumifyhubUi";

const CREATE = "__create__";

export function WorkspaceLinkDialog() {
  const { linkWorkspaceId } = useSnapshot(lumifyhubUi);
  const { data: workspaces = [] } = useWorkspacesQuery();
  const workspace = workspaces.find((w) => w.id === linkWorkspaceId);

  return (
    <Dialog
      open={!!workspace}
      onOpenChange={(o) => !o && lumifyhubUiActions.closeWorkspaceLink()}
    >
      <DialogContent className="max-w-md">
        {workspace && (
          <>
            <DialogHeader>
              <DialogTitle>{workspace.name} in LumifyHub</DialogTitle>
              <DialogDescription>
                Its projects can link boards there, and tasks become cards.
              </DialogDescription>
            </DialogHeader>
            {workspace.lh_workspace_slug ? (
              <Linked
                id={workspace.id}
                name={
                  workspace.lh_workspace_name ?? workspace.lh_workspace_slug
                }
                slug={workspace.lh_workspace_slug}
              />
            ) : (
              <Picker id={workspace.id} name={workspace.name} />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Picker({ id, name }: { id: string; name: string }) {
  const { data: lhWorkspaces = [], isPending } = useLhWorkspaces(true);
  const link = useLinkWorkspace();
  const [choice, setChoice] = useState(CREATE);
  // Linking to the same name is what "create" would do anyway.
  const taken = lhWorkspaces.some(
    (w) => w.name.toLowerCase() === name.toLowerCase()
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        link.mutate(
          {
            id,
            target:
              choice === CREATE ? { create: true } : { lhWorkspaceId: choice },
          },
          { onSuccess: () => lumifyhubUiActions.closeWorkspaceLink() }
        );
      }}
    >
      <Select value={choice} onValueChange={setChoice} disabled={isPending}>
        <SelectTrigger aria-label="LumifyHub workspace" className="h-11 sm:h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={CREATE}>
            {taken ? `Use “${name}”` : `Create “${name}”`}
          </SelectItem>
          {lhWorkspaces
            .filter((w) => w.name.toLowerCase() !== name.toLowerCase())
            .map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {link.error && (
        <p className="text-destructive text-sm">{link.error.message}</p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => lumifyhubUiActions.closeWorkspaceLink()}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={link.isPending || isPending}>
          {link.isPending ? "Linking..." : "Link workspace"}
        </Button>
      </div>
    </form>
  );
}

function Linked({
  id,
  name,
  slug,
}: {
  id: string;
  name: string;
  slug: string;
}) {
  const { data: status } = useLumifyHubStatus();
  const unlink = useUnlinkWorkspace();
  const url = status ? workspaceUrl(status.baseUrl, slug) : null;

  return (
    <div className="space-y-4">
      <div className="bg-foreground/[0.03] rounded-xl px-3 py-3">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-muted-foreground font-mono text-[11px]">{slug}</p>
      </div>
      {url && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" className="h-11 sm:h-9" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              Open in LumifyHub
            </a>
          </Button>
          <Button variant="outline" className="h-11 sm:h-9" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <Users className="h-3.5 w-3.5" />
              Share in LumifyHub
            </a>
          </Button>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        To share docs and boards with someone, invite them from the workspace in
        LumifyHub.
      </p>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          className="text-muted-foreground"
          disabled={unlink.isPending}
          onClick={() =>
            unlink.mutate(id, {
              onSuccess: () => lumifyhubUiActions.closeWorkspaceLink(),
            })
          }
        >
          Unlink
        </Button>
        <Button onClick={() => lumifyhubUiActions.closeWorkspaceLink()}>
          Done
        </Button>
      </div>
    </div>
  );
}
