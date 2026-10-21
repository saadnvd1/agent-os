// Wire types and helpers for session export. Imports nothing outside itself
// (bar the share helpers it reuses) so the sheet and the native app can use it.

import { fileName, formatBytes } from "../share/view";

export { formatBytes };

export type ExportFormat = "md" | "json" | "html";
export type ExportMode = "full" | "compact";
/** "all": mask paths, hosts and emails too. "secrets": credentials only. */
export type ExportRedact = "all" | "secrets";

export type ExportRange =
  { from: number; to: number } | { last: number } | { sinceCompaction: true };

export interface ExportRequest {
  format: ExportFormat;
  mode: ExportMode;
  range?: ExportRange;
  redact: ExportRedact;
}

export const DEFAULT_REQUEST: ExportRequest = {
  format: "md",
  mode: "compact",
  redact: "all",
};

export const EXPORT_FORMATS: {
  id: ExportFormat;
  label: string;
  hint: string;
  ext: string;
  mime: string;
}[] = [
  {
    id: "md",
    label: "Markdown",
    hint: "Best for pasting into a chat",
    ext: "md",
    mime: "text/markdown; charset=utf-8",
  },
  {
    id: "json",
    label: "JSON",
    hint: "For scripts and tools",
    ext: "json",
    mime: "application/json",
  },
  {
    id: "html",
    label: "HTML",
    hint: "To read or upload as a page",
    ext: "html",
    mime: "text/html; charset=utf-8",
  },
];

export const formatInfo = (f: ExportFormat) =>
  EXPORT_FORMATS.find((x) => x.id === f)!;

export const MAX_EXPORT_BYTES = 25 * 1024 * 1024;
export const WARN_TOKENS = 100_000;
export const DANGER_TOKENS = 1_000_000;
export const TOO_BIG =
  "That export is over 25 MB. Narrow the range or use Compact.";

export type Hits = Record<"secret" | "path" | "ip" | "host" | "email", number>;

export interface ExportTurnInfo {
  /** 0 is the part before the first message. */
  n: number;
  at: string;
  excerpt: string;
  items: number;
  tokens: number;
}

export interface ExportWarning {
  level: "info" | "warn" | "danger";
  code:
    | "sensitive"
    | "paths-included"
    | "full-output"
    | "secrets-found"
    | "large"
    | "huge"
    | "too-big";
  text: string;
}

export interface Size {
  bytes: number;
  tokens: number;
}

export interface ExportEstimate {
  title: string;
  turns: ExportTurnInfo[];
  selected: {
    from: number;
    to: number;
    of: number;
    turns: number;
    startedAt: string | null;
    endedAt: string | null;
  };
  /** The chosen format, in each mode. */
  estimate: { full: Size; compact: Size };
  hits: Hits;
  omissions: Record<string, number>;
  truncations: Record<string, number>;
  warnings: ExportWarning[];
  tooBig: boolean;
}

/** "all", "turn-12", "turns-12-18" for a file name. */
export function rangeSlug(sel: { from: number; to: number; of: number }) {
  if (sel.from <= 1 && sel.to >= sel.of) return "all";
  return sel.from === sel.to
    ? `turn-${sel.from}`
    : `turns-${sel.from}-${sel.to}`;
}

export function exportFileName(
  title: string,
  slug: string,
  format: ExportFormat
): string {
  const ext = formatInfo(format).ext;
  const base = fileName(title, "md").replace(/\.md$/, "");
  return `${base}-${slug}.${ext}`;
}

/** "about 24k tokens" */
export function tokenLabel(tokens: number): string {
  if (tokens < 1000) return `about ${tokens} tokens`;
  if (tokens < 1_000_000) return `about ${Math.round(tokens / 1000)}k tokens`;
  return `about ${(tokens / 1_000_000).toFixed(1)}M tokens`;
}

const KINDS: Record<keyof Hits, [string, string]> = {
  secret: ["credential", "credentials"],
  path: ["home path", "home paths"],
  ip: ["address", "addresses"],
  host: ["machine name", "machine names"],
  email: ["email", "emails"],
};

/** "3 credentials, 88 home paths", or "" when nothing was masked. */
export function maskedList(hits: Hits): string {
  return (Object.keys(KINDS) as (keyof Hits)[])
    .filter((k) => hits[k] > 0)
    .map((k) => `${hits[k]} ${KINDS[k][hits[k] === 1 ? 0 : 1]}`)
    .join(", ");
}

export function redactionStatus(hits: Hits): string {
  const list = maskedList(hits);
  return list ? `Masked ${list}` : "Nothing needed masking";
}

export const COMPACT_RULES = [
  "Thinking blocks are dropped (counted).",
  "Tool and command output keeps the first 10 and last 20 lines, 2,000 characters at most.",
  "Tool input is clipped to 300 characters; a shell command to 1,000.",
  "File changes become the path and +added −removed.",
  "Only the last to-do list of each turn is kept.",
  "Pages the agent showed keep their title only.",
  "A pasted block over 8,000 characters keeps its start and end.",
];
