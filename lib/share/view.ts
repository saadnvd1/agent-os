// Pure share logic: wire types and helpers. Imports nothing outside itself so
// the native app can sync it (scripts/sync-shared).

export type ShareExpiry = "1d" | "7d" | "30d" | "never";

export interface ShareTarget {
  kind: "chat" | "artifact";
  sessionId?: string;
  artifactId?: string;
  /** A page link that is re-uploaded when the page gets a new version. */
  follow?: "latest";
}

export interface PreviewRequest extends ShareTarget {
  includeTools: boolean;
  /** Messages left out of the share. */
  dropIds?: string[];
  /** Only the messages from this one to `toId`, both included; either end open when absent. */
  fromId?: string;
  toId?: string;
  /** Just the list of messages, no page: what the range picker needs first. */
  listOnly?: boolean;
}

export interface PreviewItem {
  id: string;
  type: string;
  tools: boolean;
  excerpt: string;
  createdAt?: number;
}

/** Download formats a server can make; the client lists what it is told. */
export type ShareFormat = "pdf" | "html" | "md";

export interface MessageList {
  /** Every shareable message in order, tool rows included. */
  items: PreviewItem[];
}

export interface SharePreview {
  html: string;
  markdown: string;
  title: string;
  bytes: number;
  hash: string;
  sharedAt: string;
  items: PreviewItem[];
  hits: Record<"secret" | "path" | "ip" | "host" | "email", number>;
  tooBig: boolean;
  connectLinked: boolean;
  /** Best first. pdf only when this machine has a browser to print with. */
  formats: ShareFormat[];
}

export interface SharedLinkRow {
  id: string;
  url: string;
  kind: "chat" | "artifact";
  title: string;
  sessionId: string | null;
  artifactId: string | null;
  createdAt: string;
  expiresAt: string | null;
  status: "active" | "expired" | "revoked";
  views: number | null;
  lastViewedAt: string | null;
  /** True when the link follows the page's latest version. */
  follow: boolean;
  /** The page version the link shows now. */
  version: number | null;
}

export interface SharesResponse {
  connect: "ok" | "unavailable" | "unlinked";
  shares: SharedLinkRow[];
}

export interface CreatedShare {
  id: string;
  url: string;
  expiresAt: string | null;
}

export const EXPIRIES: ShareExpiry[] = ["1d", "7d", "30d", "never"];
export const DEFAULT_EXPIRY: ShareExpiry = "7d";

export const EXPIRY_LABEL: Record<ShareExpiry, string> = {
  "1d": "1 day",
  "7d": "7 days",
  "30d": "30 days",
  never: "Never",
};

export const TYPE_LABEL: Record<string, string> = {
  user: "You",
  assistant: "Agent",
  plan: "Plan",
  error: "Error",
  divider: "Divider",
  artifact: "Page",
  detail: "Tool",
};

const PLURAL: Record<keyof SharePreview["hits"], [string, string]> = {
  secret: ["secret", "secrets"],
  path: ["path", "paths"],
  ip: ["address", "addresses"],
  host: ["host", "hosts"],
  email: ["email", "emails"],
};

/** "Masked: 3 secrets, 12 paths", or "" when nothing was. */
export function redactionSummary(hits: SharePreview["hits"]): string {
  const parts = (Object.keys(PLURAL) as (keyof typeof PLURAL)[])
    .filter((k) => hits[k] > 0)
    .map((k) => `${hits[k]} ${PLURAL[k][hits[k] === 1 ? 0 : 1]}`);
  return parts.length ? `Masked: ${parts.join(", ")}` : "";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A file name for a download: the title, plain, with .html (or `ext`). */
export function fileName(
  title: string,
  ext: "html" | "md" | "pdf" = "html"
): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "shared"}.${ext}`;
}

export function toggleDrop(dropped: string[], id: string): string[] {
  return dropped.includes(id)
    ? dropped.filter((x) => x !== id)
    : [...dropped, id];
}

/** True when every listed item is dropped. Ids of items no longer listed (tool rows hidden by turning tools off) don't count. */
export function nothingLeft(items: PreviewItem[], dropped: string[]): boolean {
  return items.every((i) => dropped.includes(i.id));
}
