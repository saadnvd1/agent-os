"use client";

import { AlertTriangle } from "lucide-react";
import type { AgentRoleView } from "@/lib/models/agent-roles-view";
import { analystBlock, defaultAnalystLabel } from "@/lib/models/usable";
import { cn } from "@/lib/utils";
import { PickerSetting } from "@/components/Settings/PickerSetting";
import { RoleModelSelect } from "./RoleModelSelect";

const SOURCE: Record<string, string> = {
  task: "Set for the task",
  project: "From this project",
  workspace: "From the workspace",
  settings: "Set in Settings",
  env: "From the server's environment",
  inherited: "Same as Gate review until set here",
  default: "Default",
};

// One role as settings rows: the model it runs on, where that came from, and
// whether the model's server answers. A role whose local model is down says so.
export function AgentRoleCard({
  role,
  scope,
  onChange,
  onFallback,
}: {
  role: AgentRoleView;
  scope: "settings" | "workspace" | "project";
  onChange: (ref: string | null) => Promise<unknown>;
  onFallback: (ref: string | null) => Promise<unknown>;
}) {
  const down = role.choice?.availability.state === "down";
  const analyst = role.id === "analyst";
  const label = analyst
    ? defaultAnalystLabel(role.default, [])
    : `Default (${role.default.split("/").slice(1).join("/")})`;
  const blockedBy = analyst ? analystBlock : undefined;
  const inheritLabel =
    scope === "settings"
      ? role.modelRole === "advise"
        ? "Same as Gate review"
        : label
      : "Inherit";
  const source = role.binding
    ? `${SOURCE[role.binding.source] ?? role.binding.source}${role.choice?.endpoint ? ` · ${role.choice.endpoint}` : ""}`
    : undefined;
  return (
    <>
      <PickerSetting<string | null>
        id={`agent-role-${role.id}`}
        label={role.label}
        help={role.purpose}
        value={role.value}
        defaultValue={null}
        hint={source}
        error={role.error}
        onSave={onChange}
        render={({ value, commit }) => (
          <RoleModelSelect
            id={`agent-role-${role.id}`}
            value={value}
            inheritLabel={
              value === null && role.binding
                ? `${inheritLabel} · ${role.binding.ref.split("/").slice(1).join("/")}`
                : inheritLabel
            }
            blockedBy={blockedBy}
            onChange={commit}
          />
        )}
        below={
          down && (
            <div
              role="alert"
              className={cn(
                "bg-destructive/10 text-foreground ring-destructive/35 my-1 flex gap-2 rounded-lg p-2.5 text-xs ring-1"
              )}
            >
              <AlertTriangle className="text-destructive mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <b className="font-medium">
                  This model&apos;s server isn&apos;t answering.
                </b>{" "}
                {role.choice?.availability.error
                  ? `${role.choice.availability.error}. `
                  : ""}
                New {role.label} sessions can&apos;t start until it is back
                {role.fallback ? ", or you start on the fallback" : ""}.
              </span>
            </div>
          )
        }
      />
      {scope === "settings" && (
        <PickerSetting<string | null>
          id={`agent-role-fallback-${role.id}`}
          label={`${role.label} fallback`}
          value={role.fallback}
          defaultValue={null}
          onSave={onFallback}
          render={({ value, commit }) => (
            <RoleModelSelect
              id={`agent-role-fallback-${role.id}`}
              value={value}
              inheritLabel="None (don't fall back)"
              claudeOnly={!analyst}
              blockedBy={blockedBy}
              onChange={commit}
            />
          )}
        />
      )}
    </>
  );
}
