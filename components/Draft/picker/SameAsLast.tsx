"use client";

import { Repeat } from "lucide-react";
import type { CatalogAgent, MachineCatalog } from "@/lib/machines/types";
import { catalogBlocker } from "../catalogBlocker";
import { ModelNote } from "./ModelNote";

export interface LastPick {
  agent: CatalogAgent;
  model: CatalogAgent["models"][number];
}

/** The newest pick in the project that this machine can still run. */
export function lastPick(catalog: MachineCatalog): LastPick | null {
  for (const r of catalog.recent) {
    const agent = catalog.agents.find((a) => a.agent === r.agent);
    const model = agent?.models.find((m) => m.value === r.model);
    if (agent && model && !catalogBlocker(agent)) return { agent, model };
  }
  return null;
}

/** One tap to the agent and model the project last used. */
export function SameAsLast({
  pick,
  projectName,
  onPick,
}: {
  pick: LastPick;
  projectName: string;
  onPick: (agent: CatalogAgent["agent"], model: string) => void;
}) {
  return (
    <button
      type="button"
      data-pick-row
      onClick={() => onPick(pick.agent.agent, pick.model.value)}
      className="bg-primary/10 hover:bg-primary/15 mx-1.5 mt-1.5 flex min-h-11 shrink-0 items-center gap-2.5 rounded-lg px-3 text-left"
    >
      <Repeat className="text-primary h-4 w-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col py-1">
        <span className="truncate text-sm font-medium">
          Same as last time in {projectName}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {pick.agent.label} · {pick.model.label}
        </span>
      </span>
      {pick.model.note && <ModelNote note={pick.model.note} />}
    </button>
  );
}
