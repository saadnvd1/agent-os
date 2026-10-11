import { NextRequest, NextResponse } from "next/server";
import { refreshSettings, setRefreshSettings } from "@/lib/chat/refresh";

// When a chat's conversation starts over (lib/chat/refresh): context
// tokens for orchestrators and for tasks, 0 for never.
export async function GET() {
  return NextResponse.json(refreshSettings());
}

export async function PUT(request: NextRequest) {
  try {
    const { orchestratorTokens, taskTokens } = await request.json();
    setRefreshSettings({ orchestratorTokens, taskTokens });
    return NextResponse.json(refreshSettings());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
