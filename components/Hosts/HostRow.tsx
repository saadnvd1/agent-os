"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Activity,
  ExternalLink,
  Monitor,
  Server,
  Trash2,
  PlugZap,
  Loader2,
  Link2,
  Unlink,
} from "lucide-react";
import { Notice } from "@/components/ui/notice";
import type { Host } from "@/lib/db";
import { useDeleteHost, useLinkHost, useTestHost } from "@/data/hosts";
import { useUnlinkPeer } from "@/data/peers";
import { NEEDS_PRO, UPGRADE_URL } from "@/lib/peer/reasons";
import { cn } from "@/lib/utils";
import { PeerActivitySheet } from "./PeerActivitySheet";

function connectLine(host: Host): string {
  if (host.peer_state === "active")
    return "Linked through Connect · tasks run on its AgentOS";
  if (host.peer_state === "suspended") return "Through Connect · suspended";
  if (host.peer_state === "unlinked")
    return `Through Connect · ${host.peer_note ?? "unlinked"}`;
  return "Through Connect · not linked";
}

/** Why a Connect link is suspended, with the way out when there is one. */
function SuspendedNote({ reason }: { reason: string | null | undefined }) {
  const plan = reason === NEEDS_PRO;
  return (
    <Notice
      tone="warning"
      className="mt-2"
      action={
        plan && (
          <Button
            asChild
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
          >
            <a href={UPGRADE_URL} target="_blank" rel="noopener noreferrer">
              Upgrade
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        )
      }
    >
      {plan
        ? "Linking machines needs Pro. Calls both ways are refused until you upgrade; it comes back without linking again."
        : `Suspended: ${reason ?? "no reason given"}. Calls both ways are refused; it comes back on its own if the machine returns to your account.`}
    </Notice>
  );
}

export function HostRow({ host }: { host: Host }) {
  const deleteHost = useDeleteHost();
  const testHost = useTestHost();
  const linkHost = useLinkHost();
  const unlink = useUnlinkPeer();
  const [activity, setActivity] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const isLocal = host.id === "local";
  const viaConnect = host.kind === "connect";
  const pinned =
    viaConnect &&
    (host.peer_state === "active" || host.peer_state === "suspended");
  const result = testHost.data;
  const Icon = isLocal ? Monitor : Server;

  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2.5">
      <div className="flex items-center gap-3">
        <Icon className="text-muted-foreground h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{host.name}</p>
          <p className="text-muted-foreground truncate text-xs">
            {isLocal
              ? "Where agent-os is running"
              : viaConnect
                ? connectLine(host)
                : host.linked
                  ? `${host.ssh_target} · tasks run on its AgentOS`
                  : host.ssh_target}
          </p>
        </div>
        {!isLocal && (
          <>
            {!viaConnect && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-11 w-11 sm:h-8 sm:w-8"
                  onClick={() => testHost.mutate(host.id)}
                  disabled={testHost.isPending}
                  aria-label="Test connection"
                >
                  {testHost.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PlugZap className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-11 w-11 sm:h-8 sm:w-8"
                  onClick={() => linkHost.mutate(host.id)}
                  disabled={linkHost.isPending}
                  aria-label={
                    host.linked ? "Link its AgentOS again" : "Link its AgentOS"
                  }
                  title="Pair with the AgentOS running there, so tasks can run on it"
                >
                  {linkHost.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )}
                </Button>
              </>
            )}
            {viaConnect && host.peer_state && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-11 w-11 sm:h-8 sm:w-8"
                onClick={() => setActivity(true)}
                aria-label="Activity"
                title="Every call to and from this machine"
              >
                <Activity className="h-4 w-4" />
              </Button>
            )}
            {pinned ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-11 w-11 sm:h-8 sm:w-8"
                onClick={() => setConfirmUnlink(true)}
                disabled={unlink.isPending || confirmUnlink}
                aria-label="Unlink"
                title="Unlink: it can no longer call this machine, nor this one it"
              >
                {unlink.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Unlink className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-11 w-11 sm:h-8 sm:w-8"
                onClick={() => deleteHost.mutate(host.id)}
                disabled={deleteHost.isPending}
                aria-label="Remove machine"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </>
        )}
      </div>
      {result && (
        <p
          className={cn(
            "mt-1.5 text-xs",
            result.ok
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-destructive"
          )}
        >
          {result.ok
            ? `Connected to ${result.hostname} · ${result.tmux}`
            : result.error}
        </p>
      )}
      {linkHost.data && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Linked to {linkHost.data.url}
        </p>
      )}
      {linkHost.error && (
        <p className="text-destructive mt-1.5 text-xs">
          {linkHost.error.message}
        </p>
      )}
      {host.peer_state === "suspended" && (
        <SuspendedNote reason={host.peer_note} />
      )}
      {confirmUnlink && (
        <Notice
          tone="warning"
          className="mt-2"
          action={
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 sm:min-h-8"
                onClick={() => setConfirmUnlink(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="min-h-11 sm:min-h-8"
                onClick={() => {
                  setConfirmUnlink(false);
                  unlink.mutate(host.id);
                }}
              >
                Unlink
              </Button>
            </div>
          }
        >
          Unlink {host.name}? It&apos;s unlinked on both machines, and linking
          them again needs a fresh pairing with new codes.
        </Notice>
      )}
      {unlink.data && !unlink.data.told && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Unlinked here. {host.name} couldn&apos;t be told now; its next call is
          refused and it will show as unlinked.
        </p>
      )}
      {unlink.error && (
        <p className="text-destructive mt-1.5 text-xs">
          {unlink.error.message}
        </p>
      )}
      {viaConnect && (
        <PeerActivitySheet
          hostId={activity ? host.id : null}
          name={host.name}
          onClose={() => setActivity(false)}
        />
      )}
      {deleteHost.error && (
        <p className="text-destructive mt-1.5 text-xs">
          {deleteHost.error.message}
        </p>
      )}
    </div>
  );
}
