/**
 * A linked machine's session: its chat and files are there, so its own
 * AgentOS lists and serves them, with its own roots and secret filter. What
 * comes back is checked field by field and re-served with this machine's
 * headers, never passed through as it came.
 */

import { ARTIFACT_HEADERS } from "../artifacts/serve";
import { IMAGE_TYPES } from "../artifacts/image-paths";
import { IMAGE_CSP } from "../artifacts/serve";
import {
  cleanRemoteText,
  hostApi,
  isConnectLink,
  type HostLink,
} from "../hosts/remote-api";
import type {
  ArtifactKind,
  ArtifactPreview,
  ArtifactState,
  SessionArtifact,
} from "./types";
import type { Content } from "./serve";

const MAX_PEER_ARTIFACTS = 1000;
export const MAX_PEER_BYTES = 20 * 1024 * 1024;

const KINDS = new Set<ArtifactKind>([
  "plan",
  "file",
  "page",
  "image",
  "log",
  "pr",
  "run",
  "session-log",
]);
const STATES = new Set<ArtifactState>([
  "live",
  "kept",
  "in-pr",
  "gone",
  "outside",
]);
const PREVIEWS = new Set<ArtifactPreview>([
  "markdown",
  "html",
  "image",
  "text",
  "none",
]);
const ID = /^[0-9a-f]{16}$/;

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

export function cleanPeerArtifact(raw: unknown): SessionArtifact | null {
  const a = raw as Record<string, unknown> | null;
  if (!a || typeof a !== "object") return null;
  if (typeof a.id !== "string" || !ID.test(a.id)) return null;
  if (!KINDS.has(a.kind as ArtifactKind)) return null;
  if (!STATES.has(a.state as ArtifactState)) return null;
  if (!PREVIEWS.has(a.preview as ArtifactPreview)) return null;
  const url =
    typeof a.url === "string" && /^https:\/\//.test(a.url)
      ? cleanRemoteText(a.url)
      : undefined;
  return {
    id: a.id,
    kind: a.kind as ArtifactKind,
    name: cleanRemoteText(a.name) || "Untitled",
    ...(typeof a.path === "string" && { path: cleanRemoteText(a.path) }),
    at: num(a.at) ?? 0,
    ...(num(a.size) !== undefined && { size: num(a.size) }),
    ...(num(a.edits) && { edits: num(a.edits) }),
    state: a.state as ArtifactState,
    preview: a.preview as ArtifactPreview,
    ...((a.by === "you" || a.by === "shell") && { by: a.by }),
    ...(typeof a.detail === "string" && { detail: cleanRemoteText(a.detail) }),
    ...(typeof a.folder === "string" && { folder: cleanRemoteText(a.folder) }),
    ...(url && { url }),
  };
}

export async function peerArtifacts(
  link: HostLink,
  sessionId: string
): Promise<SessionArtifact[]> {
  const { artifacts } = await hostApi<{ artifacts?: unknown }>(
    link,
    `/api/sessions/${encodeURIComponent(sessionId)}/artifacts`
  );
  if (!Array.isArray(artifacts)) return [];
  return artifacts
    .slice(0, MAX_PEER_ARTIFACTS)
    .map(cleanPeerArtifact)
    .filter((a): a is SessionArtifact => !!a);
}

async function readBytes(
  res: Response,
  max: number
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(res.headers.get("content-length")) > max)
    throw new Error("too large");
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error("too large");
    }
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

const IMAGE_MEDIA = new Set(Object.values(IMAGE_TYPES));
const TEXT_HEADERS = (type: string) => ({
  "Content-Type": `${type}; charset=utf-8`,
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-cache",
});

// Our own headers for what the peer says it is; anything else is refused.
export function peerHeaders(
  contentType: string
): Record<string, string> | null {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "text/html") return ARTIFACT_HEADERS;
  if (type === "text/plain" || type === "text/markdown")
    return TEXT_HEADERS(type);
  if (IMAGE_MEDIA.has(type))
    return {
      "Content-Type": type,
      "Content-Security-Policy": IMAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
    };
  return null;
}

export async function peerContent(
  link: HostLink,
  sessionId: string,
  artifactId: string
): Promise<Content> {
  if (!ID.test(artifactId))
    return { ok: false, status: 404, error: "Not found" };
  if (isConnectLink(link))
    return {
      ok: false,
      status: 409,
      error: `${link.hostName} is linked through Connect: artifacts need a Tailscale/ssh link for now`,
    };
  let res: Response;
  try {
    res = await fetch(
      `${link.url}/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${artifactId}`,
      {
        headers: { Authorization: `Bearer ${link.token}` },
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      }
    );
  } catch {
    return {
      ok: false,
      status: 502,
      error: `Can't reach AgentOS on ${link.hostName}`,
    };
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return {
      ok: false,
      status: res.status === 404 || res.status === 403 ? res.status : 502,
      error: `${link.hostName}: HTTP ${res.status}`,
    };
  }
  const headers = peerHeaders(res.headers.get("content-type") ?? "");
  if (!headers) {
    await res.body?.cancel().catch(() => undefined);
    return { ok: false, status: 502, error: "Unexpected content" };
  }
  try {
    const body = await readBytes(res, MAX_PEER_BYTES);
    return { ok: true, body, headers };
  } catch {
    return { ok: false, status: 502, error: "Too large" };
  }
}
