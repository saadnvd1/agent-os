import { NextResponse } from "next/server";
import { z } from "zod";
import { getMessageContext } from "@/lib/search/conversations";

const Query = z.object({
  session: z.string().min(1).max(100),
  item: z.string().min(1).max(200),
  around: z.coerce.number().int().min(0).max(6).default(3),
});

// GET /api/search/conversations/context?session=&item=&around= - a message and
// the ones around it, for the preview. Read-only.
export async function GET(request: Request) {
  const parsed = Query.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!parsed.success)
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { session, item, around } = parsed.data;
  const items = getMessageContext(session, item, around);
  if (!items) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { items },
    { headers: { "Cache-Control": "no-store" } }
  );
}
