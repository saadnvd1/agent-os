"use client";

import { useEffect } from "react";
import { Bot } from "lucide-react";
import type { Draft } from "@/lib/drafts";
import { AGENT_OPTIONS, agentLabel } from "@/lib/agent-options";
import { resolveModelForAgent } from "@/lib/model-catalog";
import { useMachineCatalog } from "@/data/machines";
import type { CatalogAgent, MachineCatalog } from "@/lib/machines/types";
import { ChipHeading, ChipItem, ChipMenu } from "./Chip";

// What stands between an agent and its first prompt, if anything.
export function catalogBlocker(a: CatalogAgent): string | null {
  if (!a.installed) return "Not installed";
  if (a.auth === "needs-login") return a.hint ?? "Needs sign-in";
  return null;
}

/** The agent to use when the one chosen can't run on this machine. */
export function usableAgent(
  catalog: MachineCatalog,
  agentType: Draft["agentType"]
): CatalogAgent | null {
  const have = catalog.agents.find((a) => a.agent === agentType);
  if (have && !catalogBlocker(have)) return null;
  return catalog.agents.find((a) => !catalogBlocker(a)) ?? null;
}

/**
 * The agent and its model in one menu, grouped by agent, from what the
 * machine the session will run on reports. A local Ollama model picks the
 * agent that can run it.
 */
export function AgentModelChip({
  draft,
  onChange,
}: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const { data, isPending } = useMachineCatalog(draft.hostId);
  const catalog = data?.catalog ?? null;

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
  const label =
    model && draft.model !== current?.defaultModel
      ? `${agentLabel(draft.agentType)} · ${model.label}`
      : agentLabel(draft.agentType);

  const blocker = current ? catalogBlocker(current) : null;

  return (
    <>
      <ChipMenu icon={Bot} name="Agent" label={label}>
        {!catalog &&
          AGENT_OPTIONS.map((o) => (
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
        {catalog?.agents.map((a, i) => {
          const blocked = catalogBlocker(a);
          return (
            <div key={a.agent}>
              <ChipHeading first={i === 0}>
                {a.label}
                {blocked ? ` · ${blocked}` : ""}
              </ChipHeading>
              {a.models.map((m) => (
                <ChipItem
                  key={m.value}
                  checked={
                    a.agent === draft.agentType && m.value === draft.model
                  }
                  disabled={!!blocked}
                  hint={m.description}
                  onSelect={() =>
                    onChange({ agentType: a.agent, model: m.value })
                  }
                >
                  {m.label}
                </ChipItem>
              ))}
              {a.modelsError && (
                <p className="text-muted-foreground px-2 py-1 text-xs">
                  Couldn&apos;t list its models: {a.modelsError}
                </p>
              )}
            </div>
          );
        })}
        {catalog && catalog.ollama.length > 0 && (
          <div>
            <ChipHeading>Ollama (local models)</ChipHeading>
            {catalog.ollama.map((o) => (
              <ChipItem
                key={o.name}
                checked={
                  !!o.runsWith &&
                  o.runsWith.agent === draft.agentType &&
                  o.runsWith.model === draft.model
                }
                disabled={!o.runsWith}
                hint={
                  o.runsWith
                    ? `Runs in ${agentLabel(o.runsWith.agent)}`
                    : "No agent here is set up to run it"
                }
                onSelect={() =>
                  o.runsWith &&
                  onChange({
                    agentType: o.runsWith.agent,
                    model: o.runsWith.model,
                  })
                }
              >
                {o.name}
              </ChipItem>
            ))}
          </div>
        )}
      </ChipMenu>
      {blocker && (
        <p className="w-full text-xs text-amber-600 dark:text-amber-400">
          {blocker}
          {current?.hint && blocker !== current.hint ? `: ${current.hint}` : ""}
        </p>
      )}
    </>
  );
}
