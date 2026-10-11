"use client";

import { useState } from "react";
import { ModelSelect } from "@/components/Models/ModelSelect";
import {
  useModelsQuery,
  useUpdateWorkspaceModels,
  useWorkspaceModelsQuery,
} from "@/data/models";
import { MODEL_ROLES, ROLE_LABELS, type ModelRole } from "@/lib/models/roles";

// The roles that run inside a workspace; interactive sessions and helpers
// follow Settings.
const WORKSPACE_ROLES = MODEL_ROLES.filter(
  (r): r is Exclude<ModelRole, "interactive" | "helper"> =>
    r !== "interactive" && r !== "helper"
);

// A workspace's own role models, over Settings > Models.
export function WorkspaceModelsForm({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const models = useModelsQuery(open);
  const own = useWorkspaceModelsQuery(workspaceId);
  const update = useUpdateWorkspaceModels(workspaceId);
  const roles = own.data?.roles ?? {};
  const set = Object.keys(roles).length;

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground h-11 text-left text-xs md:h-auto"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        Models: {set ? `${set} set for this workspace` : "as Settings › Models"}{" "}
        {open ? "▴" : "▾"}
      </button>
      {open && (
        <ul className="space-y-2">
          {WORKSPACE_ROLES.map((role) => (
            <li key={role} className="space-y-1">
              <label
                htmlFor={`ws-${workspaceId}-${role}`}
                className="text-muted-foreground block text-xs"
              >
                {ROLE_LABELS[role].label}
              </label>
              <ModelSelect
                id={`ws-${workspaceId}-${role}`}
                value={roles[role] ?? null}
                effective={models.data?.effective}
                inheritLabel={`As Settings (${models.data?.effective.roles[role] ?? "…"})`}
                disabled={update.isPending || !models.data}
                onChange={(ref) => {
                  const next = { ...roles };
                  if (ref) next[role] = ref;
                  else delete next[role];
                  update.mutate({ roles: next });
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {update.isError && (
        <p className="text-destructive text-xs">{update.error.message}</p>
      )}
    </div>
  );
}
