"use client";

import { useState } from "react";
import { ExternalLink, Link2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkForm } from "@/components/Welcome/ConnectBlock";
import {
  useAccountMachines,
  useRefreshAccount,
  useStartLink,
} from "@/data/peers";
import { CONNECT_SITE } from "@/lib/connect/view";
import type { AccountMachine } from "@/lib/peer/machines";
import { cn } from "@/lib/utils";
import { LinkCodeSheet } from "./LinkCodeSheet";

function MachineRow({
  machine,
  canLink,
  onLink,
  starting,
}: {
  machine: AccountMachine;
  canLink: boolean;
  onLink: () => void;
  starting: boolean;
}) {
  const linked = machine.linkState === "active";
  return (
    <div
      className={cn(
        "bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2.5",
        !canLink && !linked && "opacity-60"
      )}
    >
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          machine.online ? "bg-emerald-500" : "bg-muted-foreground/40"
        )}
        aria-label={machine.online ? "Online" : "Offline"}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{machine.name}</p>
        <p className="text-muted-foreground truncate text-xs">
          {[
            machine.online ? "Online" : "Offline",
            machine.version && `AgentOS ${machine.version}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {linked ? (
        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
          Linked
        </span>
      ) : machine.linkState === "suspended" ? (
        <span className="text-muted-foreground text-xs">Suspended</span>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-8"
          disabled={!canLink || starting}
          onClick={onLink}
        >
          {starting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
          Link
        </Button>
      )}
    </div>
  );
}

/** Machines → "On your AgentOS account": link them through Connect. */
export function AccountMachines() {
  const { data, isPending, error } = useAccountMachines(true);
  const refresh = useRefreshAccount();
  const start = useStartLink();
  const [linkId, setLinkId] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  const link = (machineId: string) => {
    setTarget(machineId);
    start.mutate(machineId, { onSuccess: (l) => setLinkId(l.id) });
  };

  if (isPending)
    return <div className="bg-muted/40 h-14 animate-pulse rounded-lg" />;
  if (error) return <p className="text-destructive text-xs">{error.message}</p>;
  if (!data.enrolled)
    return (
      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">
          Connect this machine to link it with your others
        </p>
        <LinkForm />
      </div>
    );

  const entitled = data.entitlements?.linkMachines === true;
  return (
    <section className="space-y-2" aria-label="On your AgentOS account">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">On your AgentOS account</p>
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-11 w-11 sm:h-8 sm:w-8"
          aria-label="Check your account again"
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw
            className={cn("h-4 w-4", refresh.isPending && "animate-spin")}
          />
        </Button>
      </div>
      {data.entitlements && !entitled && (
        <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm">
            Link your machines with Pro: tasks move between them over any
            network, end-to-end encrypted.
          </p>
          <Button asChild variant="outline" className="min-h-11 sm:min-h-9">
            <a
              href={`${CONNECT_SITE}/settings/billing`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Upgrade
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      )}
      {data.error && (
        <p className="text-muted-foreground text-xs">{data.error}</p>
      )}
      {data.machines.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No other machines on your account yet. Run{" "}
          <code className="font-mono">agent-os connect</code> on another
          machine, then link it here.
        </p>
      ) : (
        data.machines.map((m) => (
          <MachineRow
            key={m.id}
            machine={m}
            canLink={entitled}
            starting={start.isPending && target === m.id}
            onLink={() => link(m.id)}
          />
        ))
      )}
      {start.error && (
        <p className="text-destructive text-xs">{start.error.message}</p>
      )}
      <LinkCodeSheet
        linkId={linkId}
        onClose={() => {
          setLinkId(null);
          start.reset();
        }}
        onRetry={() => {
          setLinkId(null);
          if (target) link(target);
        }}
      />
    </section>
  );
}
