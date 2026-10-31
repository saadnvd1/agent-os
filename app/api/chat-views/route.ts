import { NextResponse } from "next/server";
import { listChatViews } from "@/lib/chat-views/store";

// GET /api/chat-views - where each chat was last being read and when, newest
// first: the switcher's recent order and the place a chat reopens at.
export async function GET() {
  return NextResponse.json({ views: listChatViews() });
}
