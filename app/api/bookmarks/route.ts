import { NextResponse } from "next/server";
import { listBookmarks } from "@/lib/bookmarks/store";

// GET /api/bookmarks?workspace=<id|all|none>&q=&before=&limit= - bookmarks
// across chats, newest first, a page at a time (`next` is the next `before`).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ws = url.searchParams.get("workspace") ?? "all";
  const limit = Number(url.searchParams.get("limit") ?? 50);
  return NextResponse.json(
    listBookmarks({
      workspace: ws === "none" ? null : ws,
      q: url.searchParams.get("q") ?? undefined,
      before: url.searchParams.get("before"),
      limit: Number.isFinite(limit) ? limit : 50,
    })
  );
}
