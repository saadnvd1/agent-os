// The completion estimate. Computed here from evidence, never by a model:
// the model may only propose which evidence backs an acceptance item, and
// this decides whether the citation holds.

import type { Estimate, EstimateItem, EvidenceRef } from "./types";

export interface AcceptanceItem {
  label: string;
  // Verified by the system itself (a loop criterion met with resolved
  // evidence), so no model mapping is needed.
  evidence?: string[];
}

export interface Stages {
  planned: boolean;
  pushed: boolean;
  prOpen: boolean;
  ciGreen: boolean;
  reviewed: boolean;
  merged: boolean;
}

export const STAGE_COUNT = 6;

// Diff, piece and log evidence is true of the work, not of one head.
const HEAD_FREE = new Set(["diff", "piece", "log", "accept", "state"]);
// A diff alone never verifies: a file changed shows nothing works.
const PROVING = new Set(["test", "ci", "review", "piece", "accept"]);

export interface Mapping {
  item: number;
  evidence: string[];
}

function holds(
  ids: string[],
  evidence: Map<string, EvidenceRef>,
  head: string | null
): boolean {
  if (!ids.length) return false;
  const cited: EvidenceRef[] = [];
  for (const id of ids) {
    const ev = evidence.get(id);
    if (!ev || ev.status !== "pass") return false;
    if (!HEAD_FREE.has(ev.kind) && head && ev.sha && ev.sha !== head)
      return false;
    cited.push(ev);
  }
  if (!cited.some((e) => PROVING.has(e.kind))) return false;
  const kinds = new Set(cited.map((e) => e.kind));
  for (const e of evidence.values())
    if (
      e.status === "fail" &&
      kinds.has(e.kind) &&
      (HEAD_FREE.has(e.kind) || !head || !e.sha || e.sha === head)
    )
      return false;
  return true;
}

export function computeEstimate(input: {
  head: string | null;
  evidence: EvidenceRef[];
  items: AcceptanceItem[];
  mappings: Mapping[];
  stages: Stages;
}): Estimate {
  const byId = new Map(input.evidence.map((e) => [e.id, e]));
  if (input.items.length) {
    const items: EstimateItem[] = input.items.map((it, i) => {
      const own = it.evidence ?? [];
      if (own.length && holds(own, byId, input.head))
        return { label: it.label, verified: true, evidence: own };
      const mapped = input.mappings
        .filter((m) => m.item === i)
        .flatMap((m) => m.evidence);
      const ids = [...new Set(mapped)];
      const ok = holds(ids, byId, input.head);
      return { label: it.label, verified: ok, evidence: ok ? ids : [] };
    });
    return {
      done: items.filter((i) => i.verified).length,
      total: items.length,
      basis: "acceptance",
      items,
    };
  }
  const s = input.stages;
  const list: [string, boolean][] = [
    ["Plan approved", s.planned],
    ["Code pushed", s.pushed],
    ["Pull request open", s.prOpen],
    ["CI green on the latest push", s.ciGreen],
    ["Review passed", s.reviewed],
    ["Merged", s.merged],
  ];
  return {
    done: list.filter(([, ok]) => ok).length,
    total: STAGE_COUNT,
    basis: "stages",
    items: list.map(([label, verified]) => ({
      label,
      verified,
      evidence: [],
    })),
  };
}
