// What a model may say in a report. Every line must cite evidence that
// exists, say only numbers that evidence contains, never use a percent sign,
// and take a tone its evidence supports. What fails is dropped and counted.

import type { EvidenceRef, LineTone, ReportLine } from "./types";
import type { Mapping } from "./estimate";

export interface ModelReport {
  headline?: unknown;
  lines?: unknown;
  recommendation?: unknown;
  acceptance?: unknown;
  nextPrompt?: unknown;
}

export interface Validated {
  headline: string | null;
  lines: ReportLine[];
  recommendation: { text: string; evidence: string[] } | null;
  mappings: Mapping[];
  nextPrompt: string | null;
  dropped: number;
}

export const MAX_LINE = 280;
export const MAX_LINES = 10;
export const MAX_PROMPT = 4000;
const TONES: LineTone[] = ["done", "warn", "blocked", "next"];

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const ids = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string"))]
    : [];

// Digits in the text that none of the cited evidence contains.
function inventedNumber(text: string, cited: EvidenceRef[]): boolean {
  const nums = text.match(/\d+/g);
  if (!nums) return false;
  const haystack = cited
    .map((e) => `${e.id} ${e.label} ${e.excerpt ?? ""} ${e.sha ?? ""}`)
    .join("\n");
  return nums.some((n) => !new RegExp(`(?<!\\d)${n}(?!\\d)`).test(haystack));
}

export function sayable(text: string, cited: EvidenceRef[]): boolean {
  return (
    !!text &&
    text.length <= MAX_LINE &&
    !/%/.test(text) &&
    !inventedNumber(text, cited)
  );
}

function toneFits(tone: LineTone, cited: EvidenceRef[]): boolean {
  if (tone === "done") return cited.some((e) => e.status === "pass");
  if (tone === "warn" || tone === "blocked")
    return cited.some(
      (e) => e.status === "fail" || e.status === "pending" || e.kind === "ask"
    );
  return true;
}

export function validateModelReport(
  raw: unknown,
  evidence: EvidenceRef[]
): Validated {
  const out: Validated = {
    headline: null,
    lines: [],
    recommendation: null,
    mappings: [],
    nextPrompt: null,
    dropped: 0,
  };
  if (!raw || typeof raw !== "object") return out;
  const m = raw as ModelReport;
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const resolve = (cites: string[]) => {
    const found = cites.map((c) => byId.get(c));
    return found.some((e) => !e) ? null : (found as EvidenceRef[]);
  };

  const headline = str(m.headline, MAX_LINE);
  if (
    headline &&
    sayable(
      headline,
      evidence.filter((e) => e.kind === "state")
    )
  )
    out.headline = headline;
  else if (headline) out.dropped++;

  const rawLines = Array.isArray(m.lines) ? m.lines.slice(0, 24) : [];
  for (const l of rawLines) {
    const o = (l ?? {}) as Record<string, unknown>;
    const tone = o.tone as LineTone;
    const text = str(o.text, MAX_LINE + 1);
    const cites = ids(o.evidence);
    const cited = cites.length ? resolve(cites) : null;
    if (
      !TONES.includes(tone) ||
      !cited ||
      !sayable(text, cited) ||
      !toneFits(tone, cited) ||
      out.lines.length >= MAX_LINES
    ) {
      out.dropped++;
      continue;
    }
    out.lines.push({
      id: `l${out.lines.length + 1}`,
      tone,
      text,
      evidence: cites,
    });
  }

  if (m.recommendation && typeof m.recommendation === "object") {
    const r = m.recommendation as Record<string, unknown>;
    const text = str(r.text, 600);
    const cites = ids(r.evidence);
    const cited = cites.length ? resolve(cites) : null;
    if (text && cited && !/%/.test(text) && !inventedNumber(text, cited))
      out.recommendation = { text, evidence: cites };
    else out.dropped++;
  }

  if (Array.isArray(m.acceptance))
    for (const a of m.acceptance.slice(0, 24)) {
      const o = (a ?? {}) as Record<string, unknown>;
      // The model sees items numbered from 1, as in "accept:1".
      if (typeof o.item === "number" && Number.isInteger(o.item) && o.item >= 1)
        out.mappings.push({ item: o.item - 1, evidence: ids(o.evidence) });
    }

  const prompt = str(m.nextPrompt, MAX_PROMPT);
  if (prompt) out.nextPrompt = prompt;
  return out;
}
