"use client";

import { useRef, useState } from "react";
import type { CatalogAgent, MachineCatalog } from "@/lib/machines/types";
import type { AgentType } from "@/lib/providers";
import { catalogBlocker } from "../catalogBlocker";
import { AgentRail, AgentStrip } from "./AgentRail";
import { ModelList } from "./ModelList";
import { PickerSheet } from "./PickerSheet";
import { SameAsLast, lastPick } from "./SameAsLast";
import { SearchField } from "./SearchField";
import { focusSelectedRow, useListKeys } from "./useListKeys";
import { useModelSearch } from "./useModelSearch";

/**
 * Pick the agent, then only its models: a rail of agents beside the list on
 * a desktop, a strip above it on a phone. "Same as last time" sets both.
 */
export function AgentModelPicker({
  open,
  onOpenChange,
  catalog,
  value,
  projectName,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: MachineCatalog;
  value: { agent: AgentType; model: string };
  projectName: string | null;
  onPick: (agent: AgentType, model: string) => void;
}) {
  const ready = catalog.agents.filter((a) => !catalogBlocker(a));
  const [browsed, setBrowsed] = useState<AgentType>(value.agent);
  const browsing: CatalogAgent | undefined =
    ready.find((a) => a.agent === browsed) ?? ready[0];
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const { query, setQuery, sections, elsewhere } = useModelSearch({
    agent: {
      agent: browsing?.agent ?? "",
      label: browsing?.label ?? "",
      models: browsing?.models ?? [],
    },
    agents: ready,
    defaultValue: browsing?.defaultModel,
    lastValue: catalog.recent.find((r) => r.agent === browsing?.agent)?.model,
  });

  const browse = (agent: AgentType, keepQuery = false) => {
    setBrowsed(agent);
    if (!keepQuery) setQuery("");
  };
  const step = (delta: 1 | -1) => {
    const at = ready.findIndex((a) => a.agent === browsing?.agent);
    const next = ready[(at + delta + ready.length) % ready.length];
    if (next) browse(next.agent);
  };
  const onKeyDown = useListKeys(root, search, step);
  const choose = (agent: AgentType, model: string) => {
    onPick(agent, model);
    onOpenChange(false);
  };
  const same = lastPick(catalog);
  const lastAgent = catalog.recent[0]?.agent;

  return (
    <PickerSheet
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setBrowsed(value.agent);
          setQuery("");
        }
        onOpenChange(o);
      }}
      title="Agent & model"
      onKeyDown={onKeyDown}
      onOpened={() => focusSelectedRow(root.current)}
    >
      <div ref={root} className="flex min-h-0 flex-1 flex-col">
        {same && !query && projectName && (
          <SameAsLast pick={same} projectName={projectName} onPick={choose} />
        )}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <div className="hidden md:block">
            <AgentRail
              agents={catalog.agents}
              browsing={browsing?.agent ?? value.agent}
              onBrowse={(a) => browse(a)}
            />
          </div>
          <div className="md:hidden">
            <AgentStrip
              agents={catalog.agents}
              browsing={browsing?.agent ?? value.agent}
              lastAgent={lastAgent}
              onBrowse={(a) => browse(a)}
            />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder={`Search ${browsing?.label ?? "agent"} models`}
              inputRef={search}
            />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {browsing && (
                <ModelList
                  sections={sections}
                  selected={browsing.agent === value.agent ? value.model : null}
                  query={query}
                  agentLabel={browsing.label}
                  elsewhere={elsewhere}
                  onPick={(model) => choose(browsing.agent, model)}
                  onJump={(a) => browse(a as AgentType, true)}
                />
              )}
              {browsing?.modelsError && (
                <p className="text-muted-foreground px-3 py-2 text-xs">
                  Couldn&apos;t list its models: {browsing.modelsError}
                </p>
              )}
            </div>
          </div>
        </div>
        <p className="text-muted-foreground bg-foreground/[0.03] hidden shrink-0 gap-3 px-3 py-1.5 text-[11px] md:flex">
          <span>←→ agent</span>
          <span>↑↓ model</span>
          <span>⏎ select</span>
          <span>/ search</span>
          <span>esc close</span>
        </p>
      </div>
    </PickerSheet>
  );
}
