"use client";

import { Switch } from "@/components/ui/switch";
import { useMcpServersQuery, useUpdateWorkspace } from "@/data/workspaces";
import type { Workspace } from "@/lib/db";

// Which MCP servers a workspace's orchestrator may use. Servers carry their
// own auth, so none is allowed unless ticked here.
export function McpServersForm({ workspace }: { workspace: Workspace }) {
  const { data: configured = [] } = useMcpServersQuery();
  const update = useUpdateWorkspace();
  const allowed = workspace.orch_mcp_servers;
  // A ticked server no longer configured stays listed, so it can be unticked.
  const names = [...new Set([...configured, ...allowed])];

  const toggle = (name: string, on: boolean) =>
    update.mutate({
      id: workspace.id,
      mcpServers: on ? [...allowed, name] : allowed.filter((n) => n !== name),
    });

  return (
    <div className="bg-muted/40 space-y-2 rounded-lg px-3 py-2.5">
      <div>
        <p className="text-sm font-medium">
          MCP servers its orchestrator may use
        </p>
        <p className="text-muted-foreground text-xs">
          All of a ticked server&apos;s tools are allowed. Sending a message,
          email or post through one still goes to you as an ask. Takes effect at
          its next turn.
        </p>
      </div>
      {names.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No MCP servers are configured on this machine.
        </p>
      ) : (
        names.map((name) => (
          <label
            key={name}
            className="flex min-h-11 items-center justify-between gap-3 text-sm"
          >
            <span className="min-w-0 truncate">{name}</span>
            <Switch
              checked={allowed.includes(name)}
              onCheckedChange={(on) => toggle(name, on)}
            />
          </label>
        ))
      )}
    </div>
  );
}
