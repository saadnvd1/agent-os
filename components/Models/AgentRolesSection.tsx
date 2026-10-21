"use client";

import { useState } from "react";
import { useAgentRolesQuery, useSaveAgentRoles } from "@/data/models";
import { useProjectsQuery } from "@/data/projects/queries";
import { useWorkspacesQuery } from "@/data/workspaces";
import type { RoleMap } from "@/lib/models/config";
import type { RoleScope } from "@/lib/models/agent-roles-view";
import { cn } from "@/lib/utils";
import { AgentRoleCard } from "./AgentRoleCard";

const SCOPES: { id: RoleScope; label: string }[] = [
  { id: "settings", label: "Default" },
  { id: "workspace", label: "Workspace" },
  { id: "project", label: "Project" },
];

// Settings > Agent roles: the model each of Developer, Analyst, Reviewer and
// Supervisor runs on, for everything or for one workspace or project.
export function AgentRolesSection() {
  const [scope, setScope] = useState<RoleScope>("settings");
  const [target, setTarget] = useState<string | null>(null);
  const workspaces = useWorkspacesQuery();
  const projects = useProjectsQuery();
  const options =
    scope === "workspace"
      ? (workspaces.data ?? []).map((w) => ({ id: w.id, name: w.name }))
      : scope === "project"
        ? (projects.data ?? [])
            .filter((p) => !p.is_uncategorized)
            .map((p) => ({ id: p.id, name: p.name }))
        : [];
  const id = scope === "settings" ? null : (target ?? options[0]?.id ?? null);
  const { data, isPending, isError, error } = useAgentRolesQuery(scope, id);
  const save = useSaveAgentRoles(scope, id);

  const saved = (key: "value" | "fallback"): RoleMap =>
    Object.fromEntries(
      (data?.roles ?? [])
        .filter((r) => r[key])
        .map((r) => [r.modelRole, r[key] as string])
    );
  const setRole = (modelRole: string, ref: string | null) => {
    const roles: RoleMap = { ...saved("value") };
    if (ref) roles[modelRole as keyof RoleMap] = ref;
    else delete roles[modelRole as keyof RoleMap];
    save.mutate({ roles });
  };
  const setFallback = (modelRole: string, ref: string | null) => {
    const fallbacks: RoleMap = { ...saved("fallback") };
    if (ref) fallbacks[modelRole as keyof RoleMap] = ref;
    else delete fallbacks[modelRole as keyof RoleMap];
    save.mutate({ roles: saved("value"), fallbacks });
  };

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        className="bg-muted inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl p-0.5"
      >
        {SCOPES.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={scope === s.id}
            type="button"
            onClick={() => {
              setScope(s.id);
              setTarget(null);
            }}
            className={cn(
              "h-11 rounded-lg px-3 text-sm whitespace-nowrap md:h-8",
              scope === s.id
                ? "bg-background text-foreground ring-border ring-1"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {scope !== "settings" && (
        <select
          aria-label={scope === "workspace" ? "Workspace" : "Project"}
          value={id ?? ""}
          onChange={(e) => setTarget(e.target.value)}
          className="border-input bg-background h-11 w-full rounded-md border px-3 text-sm md:h-9"
        >
          {options.length === 0 && <option value="">None yet</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      <p className="text-muted-foreground text-xs">
        The model each role runs on. A workspace or project can override these,
        and a session can when it starts. A Pi model (a server you run) runs
        sessions started in the role; tasks and the merge gate stay on Claude
        Code models. Planning, gate review, scope check, helpers and watchers
        are in Models.
      </p>
      {scope !== "settings" && !id ? (
        <p className="text-muted-foreground text-sm">
          There is no {scope} to set roles for yet.
        </p>
      ) : isPending ? (
        <div className="bg-muted/40 h-64 animate-pulse rounded-lg" />
      ) : isError ? (
        <p className="text-destructive text-sm">{error.message}</p>
      ) : data ? (
        <ul className="space-y-2.5">
          {data.roles.map((r) => (
            <AgentRoleCard
              key={r.id}
              role={r}
              scope={scope}
              pending={save.isPending}
              onChange={(ref) => setRole(r.modelRole, ref)}
              onFallback={(ref) => setFallback(r.modelRole, ref)}
            />
          ))}
        </ul>
      ) : null}
      {save.isError && (
        <p className="text-destructive text-xs">{save.error.message}</p>
      )}
    </div>
  );
}
