/**
 * The share flow, shared by the preview and create routes: the same inputs
 * always render the same page, so create can prove it uploads exactly what
 * the preview showed (by hash) without trusting any markup from the client.
 */

import { createHash } from "crypto";
import type { ShareExpiry } from "@/lib/connect/control-api";
import { getSession } from "@/lib/chat/registry";
import { getArtifact } from "@/lib/artifacts/store";
import { shareContext } from "./context";
import type { Hits } from "./redact";
import {
  MAX_SHARE_BYTES,
  renderArtifactSnapshot,
  renderChatSnapshot,
} from "./render";
import { artifactToMarkdown, chatToMarkdown } from "./markdown";
import { buildArtifactSnapshot, buildChatSnapshot } from "./snapshot";

export interface ShareRequest {
  kind: "chat" | "artifact";
  sessionId?: string;
  artifactId?: string;
  includeTools: boolean;
  /** Messages the reader left out in the preview. */
  dropIds?: string[];
  follow?: "latest";
  sharedAt: string;
}

export interface ItemRow {
  id: string;
  type: string;
  tools: boolean;
  excerpt: string;
}

export interface Page {
  html: string;
  markdown: string;
  title: string;
  bytes: number;
  hash: string;
  hits: Hits;
  /** Every item that could be shared, for the dialog's list. */
  items: ItemRow[];
  tooBig: boolean;
}

export class BadShare extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export const EXPIRIES: ShareExpiry[] = ["1d", "7d", "30d", "never"];
const ID = /^[\w-]{1,80}$/;

/** The request body as a ShareRequest, or a BadShare saying what's wrong. */
export function parseRequest(raw: unknown, sharedAt?: unknown): ShareRequest {
  const b = (raw ?? {}) as Record<string, unknown>;
  const kind = b.kind;
  if (kind !== "chat" && kind !== "artifact")
    throw new BadShare("kind must be chat or artifact", 400);
  const sessionId = typeof b.sessionId === "string" ? b.sessionId : undefined;
  const artifactId =
    typeof b.artifactId === "string" ? b.artifactId : undefined;
  if (
    kind === "chat"
      ? !sessionId || !ID.test(sessionId)
      : !artifactId || !ID.test(artifactId)
  )
    throw new BadShare(
      `${kind === "chat" ? "sessionId" : "artifactId"} is required`,
      400
    );
  let dropIds: string[] | undefined;
  if (b.dropIds !== undefined) {
    if (
      !Array.isArray(b.dropIds) ||
      b.dropIds.some((i) => typeof i !== "string")
    )
      throw new BadShare("dropIds must be a list of ids", 400);
    dropIds = b.dropIds as string[];
  }
  if (b.follow !== undefined && b.follow !== "latest")
    throw new BadShare("follow must be latest", 400);
  if (b.follow && kind !== "artifact")
    throw new BadShare("Only a page can follow its latest version", 400);
  const at = typeof sharedAt === "string" ? sharedAt : new Date().toISOString();
  if (Number.isNaN(Date.parse(at)))
    throw new BadShare("sharedAt is not a date", 400);
  return {
    kind,
    sessionId,
    artifactId,
    includeTools: b.includeTools === true,
    dropIds,
    follow: b.follow === "latest" ? "latest" : undefined,
    sharedAt: at,
  };
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Binds both parts: neither can change without the hash changing. */
export const pageHash = (html: string, markdown: string) =>
  sha256(`${sha256(html)}\n${sha256(markdown)}`);

export async function buildPage(req: ShareRequest): Promise<Page> {
  const ctx = shareContext();
  let html: string;
  let markdown: string;
  let title: string;
  let hits: Hits;
  let items: ItemRow[] = [];

  if (req.kind === "chat") {
    let session;
    try {
      session = getSession(req.sessionId!);
    } catch {
      throw new BadShare("No such chat", 404);
    }
    if (session.view !== "chat")
      throw new BadShare("Only chats can be shared", 400);
    const all = await buildChatSnapshot(req.sessionId!, ctx, {
      includeTools: req.includeTools,
    });
    items = all.items.map(({ id, type, tools, excerpt }) => ({
      id,
      type,
      tools,
      excerpt,
    }));
    const snap = req.dropIds?.length
      ? await buildChatSnapshot(req.sessionId!, ctx, {
          includeTools: req.includeTools,
          dropIds: req.dropIds,
        })
      : all;
    if (!snap.items.length)
      throw new BadShare("Nothing to share: every message is left out", 400);
    html = renderChatSnapshot(snap, { sharedAt: req.sharedAt });
    markdown = chatToMarkdown(snap, { sharedAt: req.sharedAt });
    title = snap.title;
    hits = snap.hits;
  } else {
    if (!getArtifact(req.artifactId!)) throw new BadShare("No such page", 404);
    const snap = await buildArtifactSnapshot(req.artifactId!, ctx);
    if (!snap) throw new BadShare("That page is gone", 404);
    html = renderArtifactSnapshot(snap.html, snap.title);
    markdown = artifactToMarkdown(snap.html, snap.title, req.sharedAt);
    title = snap.title;
    hits = snap.hits;
  }
  const bytes =
    Buffer.byteLength(html, "utf8") + Buffer.byteLength(markdown, "utf8");
  return {
    html,
    markdown,
    title,
    bytes,
    hash: pageHash(html, markdown),
    hits,
    items,
    tooBig: bytes > MAX_SHARE_BYTES,
  };
}

export const TOO_BIG =
  "Too big to share; drop some messages or turn tool calls off.";
