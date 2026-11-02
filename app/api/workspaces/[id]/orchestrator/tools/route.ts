import { NextRequest, NextResponse } from "next/server";
import { TOKEN_HEADER } from "@/lib/orchestrator/tools";
import { standingByToken } from "@/lib/leads/home";
import { NotYours, runStandingTool, UnknownTool } from "@/lib/leads/tools";

type RouteParams = { params: Promise<{ id: string }> };

const LEGACY_ASK = "ask_saad";

// The orchestrator chat's tools, and its leads', call here from their
// workers: plain text back. Each standing session's worker holds its own
// secret, which says who is calling: other local sessions are trusted by
// the network, not to act as the orchestrator or a lead.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const caller = standingByToken(id, request.headers.get(TOKEN_HEADER));
  if (!caller) return new NextResponse("Not the orchestrator", { status: 403 });
  const body = await request.json().catch(() => ({}));
  const { args } = body;
  // A worker started before the rename still calls ask_saad.
  const tool = body.tool === LEGACY_ASK ? "ask_owner" : body.tool;
  try {
    const text = await runStandingTool(id, caller, tool, args ?? {});
    return new NextResponse(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    if (error instanceof UnknownTool)
      return NextResponse.json({ error: "Unknown tool" }, { status: 400 });
    const message = error instanceof Error ? error.message : String(error);
    return new NextResponse(message, {
      status: error instanceof NotYours ? 403 : 400,
    });
  }
}
