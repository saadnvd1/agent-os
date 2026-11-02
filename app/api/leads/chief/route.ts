import { NextRequest, NextResponse } from "next/server";
import { chiefView } from "@/lib/leads/chief";

// What a chief of staff's chat shows above its messages: its workspace,
// how far it may act, and its daily sweep. `chief: null` for any other chat.
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId") ?? "";
  return NextResponse.json({ chief: chiefView(sessionId) });
}
