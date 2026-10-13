// The line a run ends with: `RESULT: ok build=143 version=1.4.2 — one sentence`.

export interface RunResult {
  ok: boolean;
  outputs: Record<string, string>;
  summary: string;
}

const RESULT_LINE = /^\s*[⏺●•]?\s*RESULT:\s*(ok|failed)\b(.*)$/gm;
const KEY = /^[a-z][a-z0-9_]{0,23}$/;
const VALUE = /^[A-Za-z0-9._:/#-]{1,64}$/;
export const MAX_OUTPUTS = 8;
export const MAX_SUMMARY = 300;

// Keys and values a next run can safely be shown: anything else is dropped.
export function cleanOutputs(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_OUTPUTS) break;
    const value = typeof v === "number" ? String(v) : v;
    if (KEY.test(k) && typeof value === "string" && VALUE.test(value))
      out[k] = value;
  }
  return out;
}

export function cleanSummary(text: unknown): string {
  if (typeof text !== "string") return "";
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > MAX_SUMMARY ? `${one.slice(0, MAX_SUMMARY - 1)}…` : one;
}

// The last RESULT line in the text, or null.
export function parseResult(text: string | null | undefined): RunResult | null {
  if (!text) return null;
  let last: RegExpExecArray | null = null;
  for (const m of text.matchAll(RESULT_LINE)) last = m;
  if (!last) return null;
  const rest = last[2];
  const dash = rest.search(/\s(?:—|--)\s/);
  const facts = dash === -1 ? rest : rest.slice(0, dash);
  const summary =
    dash === -1 ? "" : rest.slice(dash).replace(/^\s(?:—|--)\s/, "");
  const raw: Record<string, string> = {};
  for (const m of facts.matchAll(/(?:^|\s)([a-z][a-z0-9_]*)=(\S+)/g))
    raw[m[1]] = m[2];
  return {
    ok: last[1] === "ok",
    outputs: cleanOutputs(raw),
    summary: cleanSummary(summary),
  };
}

// One line for the next run's brief and the digest: `build=143 version=1.4.2`.
export const outputsText = (outputs: Record<string, string> | null): string =>
  Object.entries(outputs ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
