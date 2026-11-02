import { NextRequest, NextResponse } from "next/server";
import { ThreadQuery, threadView } from "@/lib/leads/thread-view";

// A thread between two leads, for its card in either lead's chat: the last
// exchange up to one message (`upTo`), or all of it (`all=1`).
export async function GET(request: NextRequest) {
  const parsed = ThreadQuery.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success)
    return NextResponse.json({ error: "Bad thread query" }, { status: 400 });
  return NextResponse.json({ thread: threadView(parsed.data) });
}
