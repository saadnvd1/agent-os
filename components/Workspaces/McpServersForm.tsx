"use client";

import { SettingBlock, SettingSection } from "@/components/Settings/SettingRow";
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
    <SettingSection
      title="MCP servers"
      help="One switch per server; all its tools are allowed once it's on. Sending a message, email or post through one still asks you. Takes effect at the orchestrator's next turn."
    >
      {names.length === 0 ? (
        <SettingBlock id={`mcp-none-${workspace.id}`} label="MCP servers">
          <p className="text-muted-foreground text-xs">
            No MCP servers are configured on this machine.
          </p>
        </SettingBlock>
      ) : (
        names.map((name) => (
          <SwitchSetting
            key={name}
            id={`mcp-${workspace.id}-${name}`}
            label={name}
            checked={allowed.includes(name)}
            onSave={(on) => toggle(name, on)}
          />
        ))
      )}
    </SettingSection>
  );
}
