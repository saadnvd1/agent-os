import type { ChatModel } from "@/lib/chat/events";

export interface Section {
  key: string;
  kind: "current" | "last" | "default" | "group";
  heading: string;
  models: ChatModel[];
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);

/** Every word of the query appears in the model's name, group, id or agent. */
export function matchesQuery(
  m: ChatModel,
  agentLabel: string,
  query: string
): boolean {
  const hay =
    `${agentLabel} ${m.label} ${m.group ?? ""} ${m.value}`.toLowerCase();
  return words(query).every((w) => hay.includes(w));
}

/**
 * The list a person scans: what they used last, the agent's default, then
 * the rest under the provider that serves them. A search flattens it to the
 * matches, still grouped.
 */
export function buildSections({
  models,
  agentLabel,
  defaultValue,
  lastValue,
  currentValue,
  query,
}: {
  models: ChatModel[];
  agentLabel: string;
  defaultValue?: string;
  lastValue?: string;
  /** The model in use now: pinned on top as "Current". */
  currentValue?: string;
  query: string;
}): Section[] {
  const searching = words(query).length > 0;
  const sections: Section[] = [];
  const taken = new Set<string>();
  if (!searching) {
    const current = models.find((m) => m.value === currentValue);
    if (current) {
      sections.push({
        key: "current",
        kind: "current",
        heading: "Current",
        models: [current],
      });
      taken.add(current.value);
    }
    const last = models.find((m) => m.value === lastValue);
    if (last && !taken.has(last.value)) {
      sections.push({
        key: "last",
        kind: "last",
        heading: "Last used",
        models: [last],
      });
      taken.add(last.value);
    }
    const def = models.find((m) => m.value === defaultValue);
    if (def && !taken.has(def.value)) {
      sections.push({
        key: "default",
        kind: "default",
        heading: "Default",
        models: [def],
      });
      taken.add(def.value);
    }
  }
  const rest = models.filter(
    (m) =>
      !taken.has(m.value) && (!searching || matchesQuery(m, agentLabel, query))
  );
  const groups = new Map<string, ChatModel[]>();
  for (const m of rest) {
    const key = m.group ?? "";
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  for (const [key, list] of groups)
    sections.push({
      key: `group:${key}`,
      kind: "group",
      heading: key || "Models",
      models: list,
    });
  return sections;
}

export interface Elsewhere {
  /** Matches in the other agents. */
  count: number;
  /** The first of them that has any. */
  agent: string;
}

/** What a search that found nothing here would find in the other agents. */
export function matchesElsewhere(
  agents: { agent: string; label: string; models: ChatModel[] }[],
  current: string,
  query: string
): Elsewhere | null {
  if (!words(query).length) return null;
  let count = 0;
  let first: string | null = null;
  for (const a of agents) {
    if (a.agent === current) continue;
    const n = a.models.filter((m) => matchesQuery(m, a.label, query)).length;
    if (n && !first) first = a.agent;
    count += n;
  }
  return first ? { count, agent: first } : null;
}
