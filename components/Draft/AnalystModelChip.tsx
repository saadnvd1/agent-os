"use client";

import { Cpu } from "lucide-react";
import {
  AvailabilityDot,
  LocalityBadge,
} from "@/components/Models/ModelBadges";
import { useAnalystModels } from "@/components/Analyst/useAnalystModels";
import type { Draft } from "@/lib/drafts";
import { ChipItem, ChipMenu } from "./Chip";

// The model of the analyst a new chat starts with: the analyst role's
// default unless one is picked. The list is the server's; a model that
// can't serve an analyst is greyed with the reason.
export function AnalystModelChip({
  draft,
  projectId,
  onChange,
}: {
  draft: Draft;
  projectId: string | null;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const { choices, defaultLabel, blockedBy } = useAnalystModels(projectId);
  const picked = choices.find((c) => c.ref === draft.analystModel);
  return (
    <ChipMenu
      icon={Cpu}
      name="Analyst model"
      label={picked?.label ?? draft.analystModel ?? defaultLabel}
    >
      <ChipItem
        checked={!draft.analystModel}
        onSelect={() => onChange({ analystModel: null })}
      >
        {defaultLabel}
      </ChipItem>
      {choices.map((c) => {
        const why = c.unusable ?? blockedBy(c);
        return (
          <ChipItem
            key={c.ref}
            checked={c.ref === draft.analystModel}
            onSelect={() => onChange({ analystModel: c.ref })}
            disabled={!!why}
            hint={why ?? c.group}
          >
            <span className="flex items-center gap-1.5">
              <AvailabilityDot availability={c.availability} />
              {c.label}
              <LocalityBadge locality={c.locality} />
            </span>
          </ChipItem>
        );
      })}
    </ChipMenu>
  );
}
