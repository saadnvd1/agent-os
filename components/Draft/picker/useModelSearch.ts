import { useEffect, useMemo, useState } from "react";
import type { ChatModel } from "@/lib/chat/events";
import {
  buildSections,
  matchesElsewhere,
  type Elsewhere,
  type Section,
} from "./sections";

interface AgentModels {
  agent: string;
  label: string;
  models: ChatModel[];
}

/**
 * The query typed into a model list, and what it leaves: the sections to
 * show and, when this agent has no hit, the matches in the others.
 */
export function useModelSearch({
  agent,
  agents,
  defaultValue,
  lastValue,
  currentValue,
  open,
}: {
  agent: AgentModels;
  /** Every agent that can be picked, to look for matches beyond this one. */
  agents?: AgentModels[];
  defaultValue?: string;
  lastValue?: string;
  currentValue?: string;
  /** A picker that opens starts with an empty search. */
  open: boolean;
}): {
  query: string;
  setQuery: (q: string) => void;
  sections: Section[];
  elsewhere: Elsewhere | null;
} {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const sections = useMemo(
    () =>
      buildSections({
        models: agent.models,
        agentLabel: agent.label,
        defaultValue,
        lastValue,
        currentValue,
        query,
      }),
    [agent.models, agent.label, defaultValue, lastValue, currentValue, query]
  );
  const elsewhere = useMemo(
    () =>
      sections.length === 0 && agents
        ? matchesElsewhere(agents, agent.agent, query)
        : null,
    [sections.length, agents, agent.agent, query]
  );
  return { query, setQuery, sections, elsewhere };
}
