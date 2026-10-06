import { NextRequest, NextResponse } from "next/server";
import { ensureOrchestrator } from "@/lib/orchestrator/home";

type RouteParams = { params: Promise<{ id: string }> };

// Opens the workspace's orchestrator, making it the first time.
export async function POST(_request: NextRequest, { params }: RouteParams) {
  try {
    return NextResponse.json({
      session: ensureOrchestrator((await params).id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
