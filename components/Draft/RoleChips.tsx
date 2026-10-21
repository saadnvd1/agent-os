"use client";

import { Cpu, Users } from "lucide-react";
import {
  AvailabilityDot,
  LocalityBadge,
} from "@/components/Models/ModelBadges";
import { useAgentRolesQuery, useModelChoices } from "@/data/models";
import type { Draft } from "@/lib/drafts";
import {
  AGENT_ROLES,
  AGENT_ROLE_DEFS,
  isAgentRole,
} from "@/lib/models/agent-roles";
import { ChipItem, ChipMenu } from "./Chip";

// A draft's role and the model it runs on. The role's binding gives the
// model (Settings > Agent roles); the model chip overrides it for this
// session. Both lists come from the server.
export function RoleChips({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const roles = useAgentRolesQuery("settings");
  const { data: choices = [] } = useModelChoices(!!draft.agentRole);
  const role = isAgentRole(draft.agentRole) ? draft.agentRole : null;
  const bound = roles.data?.roles.find((r) => r.id === role);
  const override = draft.roleModel
    ? choices.find((c) => c.ref === draft.roleModel)
    : undefined;
  const current = override ?? bound?.choice ?? null;
  const modelName = (ref: string | undefined | null) =>
    ref ? ref.split("/").slice(1).join("/") : "…";
  return (
    <>
      <ChipMenu
        icon={Users}
        name="Role"
        label={role ? AGENT_ROLE_DEFS[role].label : "No role"}
      >
        <ChipItem
          checked={!role}
          onSelect={() => onChange({ agentRole: null, roleModel: null })}
          hint="A plain session on the interactive model"
        >
          No role
        </ChipItem>
        {AGENT_ROLES.map((r) => {
          const view = roles.data?.roles.find((x) => x.id === r);
          return (
            <ChipItem
              key={r}
              checked={r === role}
              onSelect={() =>
                onChange({ agentRole: r, roleModel: null, openPr: false })
              }
              hint={`${AGENT_ROLE_DEFS[r].purpose}${view?.binding ? ` · ${modelName(view.binding.ref)}` : ""}`}
            >
              {AGENT_ROLE_DEFS[r].label}
            </ChipItem>
          );
        })}
      </ChipMenu>
      {role && (
        <ChipMenu
          icon={Cpu}
          name="Model"
          label={
            draft.roleModel
              ? modelName(draft.roleModel)
              : `Role model: ${modelName(bound?.binding?.ref)}`
          }
        >
          <ChipItem
            checked={!draft.roleModel}
            onSelect={() => onChange({ roleModel: null })}
            hint={bound?.binding ? modelName(bound.binding.ref) : undefined}
          >
            Role model
          </ChipItem>
          {choices.map((c) => (
            <ChipItem
              key={c.ref}
              checked={c.ref === draft.roleModel}
              onSelect={() => onChange({ roleModel: c.ref })}
              hint={c.group}
            >
              <span className="flex items-center gap-1.5">
                <AvailabilityDot availability={c.availability} />
                {c.label}
                <LocalityBadge locality={c.locality} />
              </span>
            </ChipItem>
          ))}
        </ChipMenu>
      )}
      {role && current?.availability.state === "down" && (
        <span
          role="status"
          className="text-destructive flex h-11 items-center text-xs md:h-8"
        >
          {modelName(current.ref)} isn&apos;t answering
        </span>
      )}
    </>
  );
}
