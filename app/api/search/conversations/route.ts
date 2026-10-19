import { NextResponse } from "next/server";
import { z } from "zod";
import { searchConversations } from "@/lib/search/conversations";

const Query = z.object({
  q: z.string().max(200).default(""),
  workspace: z.string().min(1).max(100).default("all"),
  project: z.string().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(200).default(0),
  limit: z.coerce.number().int().min(1).max(30).default(20),
});

// GET /api/search/conversations?q=&workspace=<id|all>&project=&offset=&limit=
// - what was said in chats, grouped by conversation. Read-only.
export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = Query.safeParse(params);
  if (!parsed.success)
    return NextResponse.json({ error: "Bad search" }, { status: 400 });
  const { q, workspace, project, offset, limit } = parsed.data;
  return NextResponse.json(
    searchConversations(q, { workspace, project }, { offset, limit }),
    { headers: { "Cache-Control": "no-store" } }
  );
}
