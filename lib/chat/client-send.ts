import type { ChatImage } from "./events";

// What a browser's send may carry: its text and images. Who a message is
// from (`from`, `peer`) is set by the agent bus alone, never by a client.
export function clientSend(msg: unknown): {
  text: string;
  images?: ChatImage[];
} {
  const m = (msg ?? {}) as { text?: unknown; images?: unknown };
  return {
    text: typeof m.text === "string" ? m.text : "",
    images: Array.isArray(m.images) ? (m.images as ChatImage[]) : undefined,
  };
}
