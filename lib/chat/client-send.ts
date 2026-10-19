import { resolveFiles } from "../attachments/store";
import type { ChatFile, ChatImage } from "./events";
import type { CompactFirst } from "./stale";

// What a browser's send may carry: its text, images and files, and whether the
// reader chose to compact a stale chat first. Who a message is from (`from`,
// `peer`, `origin`) is set by the server alone, never by a client. Its own
// id for the message is kept only in a shape no server id takes.
export function clientSend(msg: unknown): {
  text: string;
  images?: ChatImage[];
  files?: ChatFile[];
  compact?: CompactFirst;
  id?: string;
} {
  const m = (msg ?? {}) as {
    text?: unknown;
    images?: unknown;
    files?: unknown;
    compact?: unknown;
    clientId?: unknown;
  };
  return {
    text: typeof m.text === "string" ? m.text : "",
    images: Array.isArray(m.images) ? (m.images as ChatImage[]) : undefined,
    files: resolveFiles(m.files),
    ...(m.compact === true && { compact: "yes" as const }),
    ...(isClientId(m.clientId) && { id: m.clientId }),
  };
}

export const isClientId = (id: unknown): id is string =>
  typeof id === "string" && /^user-c-[A-Za-z0-9-]{8,64}$/.test(id);
