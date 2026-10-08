import type { IncomingMessage, ServerResponse } from "http";
// The same middleware `next start` compresses with; a custom server has to
// apply it itself. Next ships it compiled, so it's always there.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const compression = require("next/dist/compiled/compression") as (opts: {
  threshold: number;
  filter: (req: IncomingMessage, res: ServerResponse) => boolean;
}) => (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

// JSON from the API, gzipped for clients that take it. Pages and assets are
// left to Next, and streams (event streams, downloads) go as they are.
const middleware = compression({
  threshold: 1024,
  filter: (req, res) =>
    !!req.url?.startsWith("/api/") &&
    /^application\/json\b/i.test(String(res.getHeader("Content-Type") ?? "")),
});

export function compressJson(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (!req.url?.startsWith("/api/")) return Promise.resolve();
  return new Promise((resolve) => middleware(req, res, resolve));
}
