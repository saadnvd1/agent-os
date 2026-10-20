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
import { AccountMachines } from "./AccountMachines";
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
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle>Machines</DialogTitle>
          <DialogDescription>
            Link your other machines to start tasks on them and move tasks
            between them. Through AgentOS Connect it works over any network.
          </DialogDescription>
        </DialogHeader>

        <AccountMachines />

        <div className="space-y-2">
          <p className="text-sm font-medium">Machines here</p>
          {isPending && (
            <div className="bg-muted/40 h-14 animate-pulse rounded-lg" />
          )}
          {hosts.map((host) => (
            <HostRow key={host.id} host={host} />
          ))}
        </div>

        <details className="group">
          <summary className="text-muted-foreground flex min-h-11 cursor-pointer items-center text-sm select-none sm:min-h-9">
            Other ways to link (Tailscale or ssh)
          </summary>
          <p className="text-muted-foreground pb-2 text-xs">
            Sessions run in tmux on any machine you can reach with ssh keys.
            Projects pick a machine; tmux sessions already running there show up
            under the project whose folder they are in.
          </p>
          <form onSubmit={handleAdd} className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="Name (e.g. devbox)"
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
        </details>
      </DialogContent>
    </Dialog>
  );
}
