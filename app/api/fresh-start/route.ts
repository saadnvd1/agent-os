import { NextRequest, NextResponse } from "next/server";
import { refreshSettings, setRefreshSettings } from "@/lib/chat/refresh";

// When a chat's conversation starts over (lib/chat/refresh): context
// tokens for orchestrators and for tasks, and above which a stale chat is
// compacted before a message (lib/chat/stale); 0 for never.
export async function GET() {
  return NextResponse.json(refreshSettings());
}

export async function PUT(request: NextRequest) {
  try {
    const { orchestratorTokens, taskTokens, staleCompactTokens } =
      await request.json();
    setRefreshSettings({ orchestratorTokens, taskTokens, staleCompactTokens });
    return NextResponse.json(refreshSettings());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
