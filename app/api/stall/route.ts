import { NextRequest, NextResponse } from "next/server";
import { setStallMinutes, stallMinutes } from "@/lib/chat/stall";

// How long a chat turn may be silent before it's flagged stalled and its
// workspace's orchestrator is told (lib/chat/stall); 0 for never.
export async function GET() {
  return NextResponse.json({ minutes: stallMinutes() });
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    return NextResponse.json({ minutes: setStallMinutes(body.minutes) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
