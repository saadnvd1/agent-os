import { NextResponse } from "next/server";
import { readCapped } from "../security/read-capped";

// An item id, a scope and a note of at most MAX_NOTE_CHARS, with room over.
export const MAX_BOOKMARK_BODY_BYTES = 8192;

/** A bookmark route's JSON body, or the response that refuses it. */
export async function readBookmarkBody(
  request: Request
): Promise<Record<string, unknown> | NextResponse> {
  const raw = await readCapped(request, MAX_BOOKMARK_BODY_BYTES);
  if (raw === null)
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // Not JSON: refused below.
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return body as Record<string, unknown>;
}
