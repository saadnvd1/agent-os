/**
 * The export flow shared by the estimate and file routes: load the chat,
 * build the redacted model once per mode (remembered for a short while, so
 * typing in the sheet doesn't rebuild), then render the chosen range.
 */

import { shareContext } from "../share/context";
import { buildDoc, type ExportDoc } from "./build";
import { sizeOf, turnInfos, warningsFor } from "./estimate";
import { renderHtml } from "./html";
import { renderJson } from "./json";
import { loadArtifacts, loadSession } from "./load";
import { renderMarkdown } from "./markdown";
import { selectTurns, type ExportInfo, type Selected } from "./summary";
import {
  MAX_EXPORT_BYTES,
  formatInfo,
  rangeSlug,
  type ExportEstimate,
  type ExportFormat,
  type ExportMode,
  type ExportRequest,
} from "./view";

const TTL_MS = 30_000;
const MAX_DOCS = 6;
const docs = new Map<string, { at: number; doc: ExportDoc }>();

async function docFor(
  sessionId: string,
  mode: ExportMode,
  redact: ExportRequest["redact"]
): Promise<{ doc: ExportDoc; key: string }> {
  const loaded = loadSession(sessionId);
  const key = `${sessionId}|${mode}|${redact}|${loaded.key}`;
  const now = Date.now();
  for (const [k, v] of docs) if (now - v.at > TTL_MS) docs.delete(k);
  const hit = docs.get(key);
  if (hit) return { doc: hit.doc, key };
  const doc = buildDoc({
    items: loaded.items,
    meta: loaded.meta,
    mode,
    redact,
    ctx: shareContext(),
    artifacts: mode === "full" ? await loadArtifacts(loaded.items) : undefined,
  });
  docs.set(key, { at: now, doc });
  while (docs.size > MAX_DOCS) docs.delete(docs.keys().next().value!);
  return { doc, key };
}

export function render(
  format: ExportFormat,
  s: Selected,
  info: ExportInfo
): string {
  return format === "md"
    ? renderMarkdown(s, info)
    : format === "json"
      ? renderJson(s, info)
      : renderHtml(s, info);
}

async function select(
  sessionId: string,
  req: ExportRequest,
  mode: ExportMode,
  generatedAt: string
) {
  const { doc } = await docFor(sessionId, mode, req.redact);
  const selected = selectTurns(doc, req.range);
  const info: ExportInfo = { mode, redact: req.redact, generatedAt };
  return { doc, selected, info };
}

export interface ExportFile {
  body: string;
  contentType: string;
  title: string;
  /** "all" or "turns-12-18", for the file name. */
  slug: string;
  bytes: number;
  tokens: number;
  tooBig: boolean;
}

export async function buildFile(
  sessionId: string,
  req: ExportRequest
): Promise<ExportFile> {
  const { selected, info } = await select(
    sessionId,
    req,
    req.mode,
    new Date().toISOString()
  );
  const body = render(req.format, selected, info);
  const size = sizeOf(body);
  return {
    body,
    contentType: formatInfo(req.format).mime,
    title: selected.doc.meta.title,
    slug: rangeSlug(selected.sel),
    ...size,
    tooBig: size.bytes > MAX_EXPORT_BYTES,
  };
}

/** Sizes, turns and warnings: no file text, so it is cheap to send. */
export async function estimate(
  sessionId: string,
  req: ExportRequest
): Promise<ExportEstimate> {
  const generatedAt = new Date().toISOString();
  const other: ExportMode = req.mode === "full" ? "compact" : "full";
  const mine = await select(sessionId, req, req.mode, generatedAt);
  const theirs = await select(sessionId, req, other, generatedAt);
  const mineSize = sizeOf(render(req.format, mine.selected, mine.info));
  const theirSize = sizeOf(render(req.format, theirs.selected, theirs.info));
  const s = mine.selected;
  const turns = s.turns;
  return {
    title: s.doc.meta.title,
    turns: turnInfos(s.doc),
    selected: {
      ...s.sel,
      turns: turns.filter((t) => t.n > 0).length,
      startedAt: turns[0]?.startedAt ?? null,
      endedAt: turns[turns.length - 1]?.endedAt ?? null,
    },
    estimate:
      req.mode === "full"
        ? { full: mineSize, compact: theirSize }
        : { compact: mineSize, full: theirSize },
    hits: s.hits,
    omissions: s.omissions,
    truncations: s.truncations,
    warnings: warningsFor(s, mineSize, req),
    tooBig: mineSize.bytes > MAX_EXPORT_BYTES,
  };
}
