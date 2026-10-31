import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markSeen, setTipsOff, tipsView } from "@/lib/tips";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const post = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("seen"),
    ids: z.array(z.string().max(80)).max(100),
    day,
  }),
  z.object({ action: z.literal("off"), off: z.boolean() }),
]);

// GET /api/tips?day=YYYY-MM-DD - today's tip and the deck that applies now.
// `day` is the caller's local date, so the tip changes at their midnight.
export async function GET(request: NextRequest) {
  const parsed = day
    .optional()
    .safeParse(request.nextUrl.searchParams.get("day") ?? undefined);
  if (!parsed.success)
    return NextResponse.json({ error: "Bad day" }, { status: 400 });
  const text = JSON.stringify(tipsView(parsed.data));
  const etag = `"${createHash("sha1").update(text).digest("hex").slice(0, 16)}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
  if (request.headers.get("if-none-match") === etag)
    return new NextResponse(null, { status: 304, headers });
  return new NextResponse(text, {
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

// POST /api/tips - { action: "seen", ids, day } or { action: "off", off }.
export async function POST(request: NextRequest) {
  const body = post.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (body.data.action === "seen") markSeen(body.data.ids, body.data.day);
  else setTipsOff(body.data.off);
  return NextResponse.json(
    tipsView(body.data.action === "seen" ? body.data.day : undefined)
  );
}
