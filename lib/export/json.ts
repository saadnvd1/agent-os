import { exportNotes, type ExportInfo, type Selected } from "./summary";

export const JSON_SCHEMA = "agentos.session-export/v1";

/** The export as JSON. Compact mode is not indented, to save tokens. */
export function renderJson(s: Selected, info: ExportInfo): string {
  const { doc, sel } = s;
  const notes = exportNotes(s, info);
  const out = {
    schema: JSON_SCHEMA,
    meta: doc.meta,
    export: {
      generatedAt: info.generatedAt,
      mode: info.mode,
      range: sel,
      redaction: { mode: info.redact, masked: s.hits },
      notes: [
        "A turn is one user message and everything the agent did until the next.",
        "Strings ending in a [truncated: …] marker were cut there; omissions are counted in `omissions` (whole export) and in each turn's `omitted`.",
        "`input` is the tool's input as JSON text.",
      ],
      summary: { range: notes.range, detail: notes.detail },
    },
    omissions: s.omissions,
    truncations: s.truncations,
    turns: s.turns.map((t) => ({
      n: t.n,
      startedAt: t.startedAt,
      endedAt: t.endedAt,
      durationMs: t.durationMs,
      costUsd: t.costUsd,
      interrupted: t.interrupted,
      ended: t.ended,
      omitted: Object.keys(t.omitted).length ? t.omitted : undefined,
      items: t.items,
    })),
  };
  return JSON.stringify(out, null, info.mode === "full" ? 2 : undefined) + "\n";
}
