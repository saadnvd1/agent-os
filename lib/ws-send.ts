import { WebSocket, type PerMessageDeflateOptions } from "ws";

// A client that stops reading (a phone asleep with the socket half open)
// would otherwise have every message queued for it in this process. Past
// this much still unsent, it's cut off; it reconnects and resumes or takes a
// fresh snapshot, which costs far less than the backlog.
export const SEND_BACKLOG_LIMIT = 4 * 1024 * 1024;

/** Sends unless the socket is closed; cuts it off when it's this far behind. */
export function sendBounded(
  ws: {
    readyState: number;
    bufferedAmount: number;
    send(data: string): void;
    terminate(): void;
  },
  data: string,
  limit = SEND_BACKLOG_LIMIT
): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > limit) {
    ws.terminate();
    return false;
  }
  ws.send(data);
  return true;
}

// Compression for JSON over the sockets: small messages (a delta, a
// keystroke's echo) aren't worth the CPU and go as they are.
export const DEFLATE: PerMessageDeflateOptions = {
  threshold: 1024,
  zlibDeflateOptions: { level: 6 },
  // No context kept between messages: a few KB per socket instead of ~300.
  serverNoContextTakeover: true,
  clientNoContextTakeover: true,
};
