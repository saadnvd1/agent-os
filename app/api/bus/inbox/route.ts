import { NextRequest, NextResponse } from "next/server";
import { readInbox } from "@/lib/bus";

export async function GET(request: NextRequest) {
  const session = request.nextUrl.searchParams.get("session");
  if (!session)
    return NextResponse.json({ error: "session is required" }, { status: 400 });
  return NextResponse.json({ messages: readInbox(session) });
}
