/**
 * The three public pairing routes: a body of at most 4 KiB, JSON, handed to
 * the pairing code, and the answer never cached.
 */

import { NextResponse, type NextRequest } from "next/server";
import { readCapped } from "../security/read-capped";
import { HELLO_MAX_BYTES } from "./hello";
import type { Reply } from "./pairing";

export function helloRoute(
  handle: (body: unknown, request: NextRequest) => Reply | Promise<Reply>
) {
  return async (request: NextRequest) => {
    const raw = await readCapped(request, HELLO_MAX_BYTES);
    let reply: Reply;
    if (raw === null) reply = { status: 413, body: { error: "too large" } };
    else {
      let body: unknown = null;
      try {
        body = JSON.parse(raw);
      } catch {
        // parsed as nothing: refused as a bad message
      }
      reply = await handle(body, request);
    }
    return NextResponse.json(reply.body, {
      status: reply.status,
      headers: { "Cache-Control": "no-store" },
    });
  };
}
