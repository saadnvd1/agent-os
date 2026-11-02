"use client";

import { SettingSection } from "@/components/Settings/SettingRow";
import { SwitchSetting } from "@/components/Settings/settings-fields";
import { useMcpServersQuery, useUpdateWorkspace } from "@/data/workspaces";
import type { Workspace } from "@/lib/db";

// Which MCP servers a workspace's orchestrator may use. Servers carry their
// own auth, so none is allowed unless switched on here.
export function McpServersForm({ workspace }: { workspace: Workspace }) {
  const { data: configured = [] } = useMcpServersQuery();
  const update = useUpdateWorkspace();
  const allowed = workspace.orch_mcp_servers;
  // An allowed server no longer configured stays listed, so it can be removed.
  const names = [...new Set([...configured, ...allowed])];

  const toggle = (name: string, on: boolean) =>
    update.mutateAsync({
      id: workspace.id,
      mcpServers: on ? [...allowed, name] : allowed.filter((n) => n !== name),
    });

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-semibold">
          MCP servers its orchestrator may use
        </p>
        <p className="text-muted-foreground text-xs">
          All of a server&apos;s tools are allowed once it&apos;s on. Sending a
          message, email or post through one still goes to you as an ask. Takes
          effect at its next turn.
        </p>
      </div>
      {names.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No MCP servers are configured on this machine.
        </p>
      ) : (
        <SettingSection>
          {names.map((name) => (
            <SwitchSetting
              key={name}
              id={`mcp-${workspace.id}-${name}`}
              label={name}
              checked={allowed.includes(name)}
              defaultValue={false}
              onSave={(on) => toggle(name, on)}
            />
          ))}
        </SettingSection>
      )}
    </div>
  );
}
