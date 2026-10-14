import { NextRequest, NextResponse } from "next/server";
import { refreshSettings, setRefreshSettings } from "@/lib/chat/refresh";

// When a chat's conversation starts over (lib/chat/refresh): context
// tokens for orchestrators and for tasks, and at which chats and tasks
// compact: between turns (lib/chat/stale) and mid-turn, by the agent itself
// (one size for tasks, one for a person's own sessions);
// 0 for never.
export async function GET() {
  return NextResponse.json(refreshSettings());
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    setRefreshSettings({
      orchestratorTokens: body.orchestratorTokens,
      taskTokens: body.taskTokens,
      // Its name before it also set the agents' own auto-compact.
      compactTokens: body.compactTokens ?? body.staleCompactTokens,
      autoCompactTokens: body.autoCompactTokens,
      interactiveAutoCompactTokens: body.interactiveAutoCompactTokens,
    });
    return NextResponse.json(refreshSettings());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
