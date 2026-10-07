"use client";

import { Button } from "@/components/ui/button";
import { Monitor, Server, Trash2, PlugZap, Loader2, Link2 } from "lucide-react";
import type { Host } from "@/lib/db";
import { useDeleteHost, useLinkHost, useTestHost } from "@/data/hosts";
import { cn } from "@/lib/utils";

export function HostRow({ host }: { host: Host }) {
  const deleteHost = useDeleteHost();
  const testHost = useTestHost();
  const linkHost = useLinkHost();
  const isLocal = host.id === "local";
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
              : host.linked
                ? `${host.ssh_target} · tasks run on its AgentOS`
                : host.ssh_target}
          </p>
        </div>
        {!isLocal && (
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
      {deleteHost.error && (
        <p className="text-destructive mt-1.5 text-xs">
          {deleteHost.error.message}
        </p>
      )}
    </div>
  );
}
