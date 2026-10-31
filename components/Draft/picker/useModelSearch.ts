import { useMemo, useState } from "react";
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
}: {
  agent: AgentModels;
  /** Every agent that can be picked, to look for matches beyond this one. */
  agents?: AgentModels[];
  defaultValue?: string;
  lastValue?: string;
}): {
  query: string;
  setQuery: (q: string) => void;
  sections: Section[];
  elsewhere: Elsewhere | null;
} {
  const [query, setQuery] = useState("");
  const sections = useMemo(
    () =>
      buildSections({
        models: agent.models,
        agentLabel: agent.label,
        defaultValue,
        lastValue,
        query,
      }),
    [agent.models, agent.label, defaultValue, lastValue, query]
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
