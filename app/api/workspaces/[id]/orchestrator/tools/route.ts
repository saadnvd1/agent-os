import { NextRequest, NextResponse } from "next/server";
import { isToolName, runTool } from "@/lib/orchestrator/serve";

type RouteParams = { params: Promise<{ id: string }> };

// The orchestrator chat's tools call here from its worker: plain text back.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { tool, args } = await request.json();
  if (!isToolName(tool))
    return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
  try {
    const text = await runTool((await params).id, tool, args ?? {});
    return new NextResponse(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new NextResponse(message, { status: 400 });
  }
}
