import { NextRequest, NextResponse } from "next/server";
import { isToolName, runTool } from "@/lib/orchestrator/serve";
import { isOrchestratorToken } from "@/lib/orchestrator/home";
import { TOKEN_HEADER } from "@/lib/orchestrator/tools";

type RouteParams = { params: Promise<{ id: string }> };

// The orchestrator chat's tools call here from its worker: plain text back.
// Only that workspace's orchestrator worker holds the secret: other local
// sessions are trusted by the network, not to act as the orchestrator.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!isOrchestratorToken(id, request.headers.get(TOKEN_HEADER)))
    return new NextResponse("Not the orchestrator", { status: 403 });
  const { tool, args } = await request.json().catch(() => ({}));
  if (!isToolName(tool))
    return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
  try {
    const text = await runTool(id, tool, args ?? {});
    return new NextResponse(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new NextResponse(message, { status: 400 });
  }
}
