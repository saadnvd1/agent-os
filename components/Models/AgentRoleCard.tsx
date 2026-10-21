"use client";

import { AlertTriangle } from "lucide-react";
import type { AgentRoleView } from "@/lib/models/agent-roles-view";
import { cn } from "@/lib/utils";
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

const initial = (label: string) => label.slice(0, 1);

// One role: what it does, the model it runs on, where that came from, and
// whether the model's server answers. A role whose local model is down says so.
export function AgentRoleCard({
  role,
  scope,
  pending,
  onChange,
  onFallback,
}: {
  role: AgentRoleView;
  scope: "settings" | "workspace" | "project";
  pending: boolean;
  onChange: (ref: string | null) => void;
  onFallback: (ref: string | null) => void;
}) {
  const down = role.choice?.availability.state === "down";
  const label = `Default (${role.default.split("/").slice(1).join("/")})`;
  const inheritLabel =
    scope === "settings"
      ? role.modelRole === "advise"
        ? "Same as Gate review"
        : label
      : "Inherit";
  return (
    <li
      className={cn(
        "bg-muted/40 space-y-2 rounded-xl px-3 py-3",
        down && "ring-destructive/50 ring-1"
      )}
    >
      <label htmlFor={`agent-role-${role.id}`} className="flex gap-2.5">
        <span className="bg-accent text-primary grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-semibold">
          {initial(role.label)}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{role.label}</span>
          <span className="text-muted-foreground block text-xs">
            {role.purpose}
          </span>
        </span>
      </label>
      <RoleModelSelect
        id={`agent-role-${role.id}`}
        value={role.value}
        inheritLabel={
          role.value === null && role.binding
            ? `${inheritLabel} · ${role.binding.ref.split("/").slice(1).join("/")}`
            : inheritLabel
        }
        disabled={pending}
        onChange={onChange}
      />
      <p className="text-muted-foreground text-xs">
        {role.error
          ? role.error
          : role.binding
            ? `${SOURCE[role.binding.source] ?? role.binding.source}${role.choice?.endpoint ? ` · ${role.choice.endpoint}` : ""}`
            : ""}
      </p>
      {down && (
        <div
          role="alert"
          className="bg-destructive/10 text-foreground ring-destructive/35 flex gap-2 rounded-lg p-2.5 text-xs ring-1"
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
      )}
      {scope === "settings" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">Fallback</span>
          <div className="min-w-44 flex-1">
            <RoleModelSelect
              id={`agent-role-fallback-${role.id}`}
              value={role.fallback}
              inheritLabel="None (don't fall back)"
              claudeOnly
              disabled={pending}
              onChange={onFallback}
            />
          </div>
        </div>
      )}
    </li>
  );
}
