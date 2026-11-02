"use client";

import { useState } from "react";
import { PickerSetting } from "@/components/Settings/PickerSetting";
import { SettingBlock } from "@/components/Settings/SettingRow";
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
    <>
      <SettingBlock id={`models-${workspaceId}`} label="Models">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex min-h-11 w-full items-center text-left text-xs md:min-h-0"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {set ? `${set} set for this workspace` : "As Settings › Models"}{" "}
          {open ? "▴" : "▾"}
        </button>
      </SettingBlock>
      {open &&
        WORKSPACE_ROLES.map((role) => (
          <PickerSetting<string | null>
            key={role}
            id={`ws-${workspaceId}-${role}`}
            label={ROLE_LABELS[role].label}
            value={roles[role] ?? null}
            defaultValue={null}
            onSave={(ref) => {
              const next = { ...roles };
              if (ref) next[role] = ref;
              else delete next[role];
              return update.mutateAsync({ roles: next });
            }}
            render={({ value, commit }) => (
              <ModelSelect
                id={`ws-${workspaceId}-${role}`}
                value={value}
                effective={models.data?.effective}
                inheritLabel={`As Settings (${models.data?.effective.roles[role] ?? "…"})`}
                disabled={!models.data}
                onChange={commit}
              />
            )}
          />
        ))}
    </>
  );
}
