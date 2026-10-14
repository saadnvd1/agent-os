import { NextResponse } from "next/server";
import {
  BookmarkError,
  createBookmark,
  listSessionBookmarks,
} from "@/lib/bookmarks/store";
import { readBookmarkBody } from "@/lib/bookmarks/body";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/sessions/:id/bookmarks - this chat's bookmarks, in chat order.
// A deleted chat's still list: they outlive it.
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  return NextResponse.json({ bookmarks: listSessionBookmarks(id) });
}

// POST /api/sessions/:id/bookmarks { itemId, scope?, note? } - bookmark one
// item, or (scope 'turn') the turn its user message starts. 201 when made,
// 200 with the one already there.
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await readBookmarkBody(request);
  if (body instanceof NextResponse) return body;
  try {
    const { bookmark, created } = createBookmark({
      sessionId: id,
      itemId: body.itemId,
      scope: body.scope,
      note: body.note,
    });
    return NextResponse.json({ bookmark }, { status: created ? 201 : 200 });
  } catch (err) {
    if (err instanceof BookmarkError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
