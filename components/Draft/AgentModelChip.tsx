"use client";

import { useEffect, useState } from "react";
import { Bot } from "lucide-react";
import type { Draft } from "@/lib/drafts";
import { AGENT_OPTIONS, agentLabel } from "@/lib/agent-options";
import { resolveModelForAgent } from "@/lib/model-catalog";
import { useMachineCatalog } from "@/data/machines";
import { catalogBlocker, usableAgent } from "./catalogBlocker";
import { ChipItem, ChipMenu, ChipTrigger } from "./Chip";
import { AgentModelPicker } from "./picker/AgentModelPicker";

export { catalogBlocker, usableAgent };

/**
 * The agent and its model in one picker, from what the machine the session
 * will run on reports: pick the agent, then only its models.
 */
export function AgentModelChip({
  draft,
  projectName,
  onChange,
}: {
  draft: Draft;
  projectName: string | null;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const { data, isPending } = useMachineCatalog(draft.hostId, draft.projectId);
  const catalog = data?.catalog ?? null;
  const [open, setOpen] = useState(false);

  // The machine changed under the draft: move to an agent it has.
  useEffect(() => {
    if (!catalog) return;
    const other = usableAgent(catalog, draft.agentType);
    if (other) onChange({ agentType: other.agent, model: other.defaultModel });
    else {
      const mine = catalog.agents.find((a) => a.agent === draft.agentType);
      if (
        mine &&
        !mine.modelsError &&
        !mine.models.some((m) => m.value === draft.model)
      )
        onChange({ model: mine.defaultModel });
    }
  }, [catalog, draft.agentType, draft.model, onChange]);

  const current = catalog?.agents.find((a) => a.agent === draft.agentType);
  const model = current?.models.find((m) => m.value === draft.model);
  const label = model
    ? `${agentLabel(draft.agentType)} · ${model.label}`
    : agentLabel(draft.agentType);
  const blocker = current ? catalogBlocker(current) : null;

  return (
    <>
      {catalog ? (
        <>
          <ChipTrigger
            icon={Bot}
            name="Agent and model"
            label={label}
            onClick={() => setOpen(true)}
          />
          <AgentModelPicker
            open={open}
            onOpenChange={setOpen}
            catalog={catalog}
            value={{ agent: draft.agentType, model: draft.model }}
            projectName={projectName}
            onPick={(agentType, m) => onChange({ agentType, model: m })}
          />
        </>
      ) : (
        <ChipMenu icon={Bot} name="Agent" label={label}>
          {AGENT_OPTIONS.map((o) => (
            <ChipItem
              key={o.value}
              checked={o.value === draft.agentType}
              hint={
                isPending
                  ? "Checking the machine…"
                  : (data?.error ?? "Couldn't check the machine")
              }
              onSelect={() =>
                onChange({
                  agentType: o.value,
                  model: resolveModelForAgent(o.value, draft.model),
                })
              }
            >
              {o.label}
            </ChipItem>
          ))}
        </ChipMenu>
      )}
      {blocker && (
        <p className="w-full text-xs text-amber-600 dark:text-amber-400">
          {blocker}
          {current?.hint && blocker !== current.hint ? `: ${current.hint}` : ""}
        </p>
      )}
    </>
  );
}
