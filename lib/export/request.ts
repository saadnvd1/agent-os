import { BadShare } from "../share/service";
import { EXPORT_FORMATS, type ExportRange, type ExportRequest } from "./view";

const int = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e7 ? v : null;

function parseRange(raw: unknown): ExportRange | undefined {
  if (raw === undefined || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof raw !== "object") throw new BadShare("bad range", 400);
  if ("sinceCompaction" in r) {
    if (r.sinceCompaction !== true) throw new BadShare("bad range", 400);
    return { sinceCompaction: true };
  }
  if ("last" in r) {
    const last = int(r.last);
    if (!last) throw new BadShare("last must be a positive number", 400);
    return { last };
  }
  const from = int(r.from);
  const to = int(r.to);
  if (!from || !to) throw new BadShare("from and to must be turn numbers", 400);
  return { from, to };
}

/** The request body as an ExportRequest, or a BadShare saying what's wrong. */
export function parseExportRequest(raw: unknown): ExportRequest {
  const b = (raw ?? {}) as Record<string, unknown>;
  const format = EXPORT_FORMATS.find((f) => f.id === b.format)?.id;
  if (!format) throw new BadShare("format must be md, json or html", 400);
  if (b.mode !== "full" && b.mode !== "compact")
    throw new BadShare("mode must be full or compact", 400);
  if (b.redact !== "all" && b.redact !== "secrets")
    throw new BadShare("redact must be all or secrets", 400);
  return { format, mode: b.mode, redact: b.redact, range: parseRange(b.range) };
}
