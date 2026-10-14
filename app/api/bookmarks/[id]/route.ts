import { NextResponse } from "next/server";
import {
  BookmarkError,
  removeBookmark,
  setBookmarkNote,
} from "@/lib/bookmarks/store";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () =>
  NextResponse.json({ error: "Bookmark not found" }, { status: 404 });

// PATCH /api/bookmarks/:id { note } - set or clear (null) its note.
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    note?: unknown;
  } | null;
  if (!body || !("note" in body))
    return NextResponse.json({ error: "note is required" }, { status: 400 });
  try {
    const bookmark = setBookmarkNote(id, body.note);
    return bookmark ? NextResponse.json({ bookmark }) : notFound();
  } catch (err) {
    if (err instanceof BookmarkError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

// DELETE /api/bookmarks/:id - unstar.
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  return removeBookmark(id) ? NextResponse.json({ ok: true }) : notFound();
}
