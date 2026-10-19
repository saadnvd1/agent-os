/**
 * What a share contains: a chat's items, or one artifact, already redacted.
 * Nothing here leaves the machine; the renderer turns it into a page.
 */

import { listItems } from "../chat/store";
import type { ChatItem } from "../chat/events";
import { getSession } from "../chat/registry";
import { getArtifact, readArtifactHtml } from "../artifacts/store";
import { isSecretPath } from "../secret-paths";
import {
  addHits,
  noHits,
  redactForShare,
  type Hits,
  type ShareContext,
} from "./redact";

export type SnapshotType =
  "user" | "assistant" | "plan" | "error" | "divider" | "artifact" | "detail";

export interface SnapshotItem {
  id: string;
  type: SnapshotType;
  /** For a detail row: what it is (a tool's title, "Thinking"). */
  label?: string;
  text: string;
  /** An artifact's page. */
  html?: string;
  height?: number;
  /** The first words, for the dialog's message list. */
  excerpt: string;
  /** Hidden unless "include tool calls and thinking" is on. */
  tools: boolean;
}

export interface Snapshot {
  title: string;
  items: SnapshotItem[];
  /** Whether the tools group was left out, to say so on the page. */
  toolsHidden: boolean;
  hits: Hits;
}

export const MAX_TOOL_INPUT = 4_000;
export const MAX_TOOL_OUTPUT = 20_000;
const HIDDEN_FILE = "[contents of a secret file hidden]";
const NO_IMAGE = "[image not shared]";

const clip = (s: string, max: number) =>
  s.length > max
    ? `${s.slice(0, max)}\n… (${s.length - max} more characters)`
    : s;

const excerptOf = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

// Every string in a tool's input, to see whether it names a secret file.
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object")
    Object.values(v).forEach((x) => strings(x, out));
  return out;
}

const json = (v: unknown) => {
  try {
    return typeof v === "string" ? v : (JSON.stringify(v, null, 2) ?? "");
  } catch {
    return "";
  }
};

/** Items as the reader sees them: what an undo took back is gone. */
export function visible(items: ChatItem[]): ChatItem[] {
  const out: ChatItem[] = [];
  for (const item of items) {
    if (item.kind !== "undo") {
      out.push(item);
      continue;
    }
    const at = out.findIndex((i) => i.id === item.from);
    if (at !== -1) out.length = at;
  }
  return out;
}

type Raw = Omit<SnapshotItem, "excerpt">;

/** One chat item as a row, or null for what is never shared. */
export function toRaw(item: ChatItem): Raw | null {
  const id = item.id;
  switch (item.kind) {
    case "user": {
      const images = item.images?.length
        ? "\n" + item.images.map(() => NO_IMAGE).join("\n")
        : "";
      return { id, type: "user", text: item.text + images, tools: false };
    }
    case "assistant":
      return item.text.trim()
        ? { id, type: "assistant", text: item.text, tools: false }
        : null;
    case "plan":
      return { id, type: "plan", text: item.plan, tools: false };
    case "error":
      return { id, type: "error", text: item.message, tools: false };
    case "compacted":
      return {
        id,
        type: "divider",
        text: "Conversation compacted",
        tools: false,
      };
    case "artifact":
      return {
        id,
        type: "artifact",
        label: item.title,
        text: "",
        height: item.height,
        tools: false,
      };
    case "reasoning":
      return item.text.trim()
        ? {
            id,
            type: "detail",
            label: "Thinking",
            text: item.text,
            tools: true,
          }
        : null;
    case "tool": {
      const secret = strings(item.input).some(isSecretPath);
      const input = clip(json(item.input), MAX_TOOL_INPUT);
      const output = secret
        ? HIDDEN_FILE
        : clip(item.output ?? "", MAX_TOOL_OUTPUT);
      return {
        id,
        type: "detail",
        label: item.title || item.name,
        text: output ? `${input}\n\n${output}` : input,
        tools: true,
      };
    }
    case "command_output":
      return {
        id,
        type: "detail",
        label: "Command output",
        text: clip(item.text, MAX_TOOL_OUTPUT),
        tools: true,
      };
    case "todos":
      return {
        id,
        type: "detail",
        label: "To do",
        text: item.todos
          .map((t) => `${t.status === "completed" ? "[x]" : "[ ]"} ${t.text}`)
          .join("\n"),
        tools: true,
      };
    case "mcp":
      return {
        id,
        type: "detail",
        label: "MCP servers",
        text: item.servers.map((s) => `${s.name}: ${s.status}`).join("\n"),
        tools: true,
      };
    case "task":
      return {
        id,
        type: "detail",
        label: item.description,
        text: item.summary ?? item.status,
        tools: true,
      };
    default:
      // approval, note, undo, turn_end
      return null;
  }
}

/** What the preview lists: every shareable item, whether or not it's on. */
export async function buildChatSnapshot(
  sessionId: string,
  ctx: ShareContext,
  opts: { includeTools: boolean; dropIds?: string[] }
): Promise<Snapshot> {
  const session = getSession(sessionId);
  const dropped = new Set(opts.dropIds ?? []);
  let hits = noHits();
  const take = (text: string) => {
    const r = redactForShare(text, ctx);
    hits = addHits(hits, r.hits);
    return r.text;
  };

  const items: SnapshotItem[] = [];
  for (const item of visible(listItems(sessionId))) {
    const raw = toRaw(item);
    if (!raw) continue;
    if (raw.tools && !opts.includeTools) continue;
    if (dropped.has(raw.id)) continue;
    const row: SnapshotItem = {
      ...raw,
      label: raw.label === undefined ? undefined : take(raw.label),
      text: take(raw.text),
      excerpt: "",
    };
    if (raw.type === "artifact") {
      const artifact = getArtifact(listArtifactId(item) ?? "");
      const html = artifact ? await readArtifactHtml(artifact) : null;
      if (html === null) continue;
      row.html = take(html);
    }
    row.excerpt = excerptOf(row.text || row.label || "");
    items.push(row);
  }
  return {
    title: take(session.name).slice(0, 120) || "Chat",
    items,
    toolsHidden: !opts.includeTools,
    hits,
  };
}

const listArtifactId = (item: ChatItem) =>
  item.kind === "artifact" ? item.artifactId : null;

export interface ArtifactSnapshot {
  title: string;
  html: string;
  hits: Hits;
}

export async function buildArtifactSnapshot(
  artifactId: string,
  ctx: ShareContext
): Promise<ArtifactSnapshot | null> {
  const artifact = getArtifact(artifactId);
  const html = artifact ? await readArtifactHtml(artifact) : null;
  if (!artifact || html === null) return null;
  const page = redactForShare(html, ctx);
  const title = redactForShare(artifact.title, ctx);
  return {
    title: title.text.slice(0, 120) || "Page",
    html: page.text,
    hits: addHits(page.hits, title.hits),
  };
}
