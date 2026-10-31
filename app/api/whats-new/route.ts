import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cachedCheck } from "@/lib/updates/check";
import { aheadEntries } from "@/lib/whats-new/ahead";
import { headOf, loadEntries, pageOf } from "@/lib/whats-new/load";

const query = z.object({
  head: z.literal("1").optional(),
  ahead: z.literal("1").optional(),
  before: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
});

// GET /api/whats-new?head=1 - the newest id and the count, for the footer's
// dot. With ahead=1: what a waiting update would add. Otherwise a page of entries, newest first, older than `before`.
// Reads a static file; nothing here calls a model.
export async function GET(request: NextRequest) {
  const parsed = query.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success)
    return NextResponse.json({ error: "Bad query" }, { status: 400 });
  const { head, ahead, before, limit } = parsed.data;
  const entries = loadEntries();
  const check = ahead ? cachedCheck() : null;
  const body = ahead
    ? {
        entries: check?.available
          ? await aheadEntries(check.latest?.sha, entries)
          : [],
      }
    : head
      ? headOf(entries)
      : pageOf(entries, { before, limit });
  const text = JSON.stringify(body);
  const etag = `"${createHash("sha1").update(text).digest("hex").slice(0, 16)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (request.headers.get("if-none-match") === etag)
    return new NextResponse(null, { status: 304, headers });
  return new NextResponse(text, {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
