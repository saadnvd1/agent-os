"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHostsQuery, useCreateHost } from "@/data/hosts";
import { HostRow } from "./HostRow";

interface HostsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function HostsDialog({ open, onClose }: HostsDialogProps) {
  const { data: hosts = [], isPending } = useHostsQuery();
  const createHost = useCreateHost();
  const [name, setName] = useState("");
  const [sshTarget, setSshTarget] = useState("");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    createHost.mutate(
      { name, sshTarget },
      {
        onSuccess: () => {
          setName("");
          setSshTarget("");
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Machines</DialogTitle>
          <DialogDescription>
            Sessions run in tmux on any machine you can reach with ssh keys.
            Projects pick a machine; tmux sessions already running there show up
            under the project whose folder they are in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {isPending && (
            <div className="bg-muted/40 h-14 animate-pulse rounded-lg" />
          )}
          {hosts.map((host) => (
            <HostRow key={host.id} host={host} />
          ))}
        </div>

        <form onSubmit={handleAdd} className="space-y-2 pt-2">
          <p className="text-sm font-medium">Add a machine</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              placeholder="Name (e.g. homelab)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11 sm:h-9"
            />
            <Input
              placeholder="ssh target (user@host or alias)"
              value={sshTarget}
              onChange={(e) => setSshTarget(e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 sm:h-9"
            />
          </div>
          {createHost.error && (
            <p className="text-sm text-red-400">{createHost.error.message}</p>
          )}
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={
                !name.trim() || !sshTarget.trim() || createHost.isPending
              }
            >
              Add machine
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
