import { NextRequest, NextResponse } from "next/server";
import {
  finishMcpSignIn,
  reconnectMcpServer,
  startMcpSignIn,
} from "@/lib/chat/mcp-auth";

// POST /api/sessions/[id]/mcp-auth - sign in to an MCP server listed in a
// chat's /mcp item: start it (answers with the link to open), finish it with
// the address the provider ended on, or reconnect.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    server?: unknown;
    itemId?: unknown;
    url?: unknown;
  } | null;
  const { action, server, itemId, url } = body ?? {};
  if (
    typeof server !== "string" ||
    !server ||
    server.length > 200 ||
    typeof itemId !== "string" ||
    !itemId ||
    itemId.length > 200
  )
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  try {
    if (action === "start")
      return NextResponse.json(
        await startMcpSignIn(id, {
          itemId,
          server,
          origin: request.headers.get("origin"),
        })
      );
    if (action === "submit") {
      if (typeof url !== "string" || !url || url.length > 4096)
        return NextResponse.json({ error: "Bad request" }, { status: 400 });
      await finishMcpSignIn(url.trim(), { sessionId: id, server });
      return NextResponse.json({ ok: true });
    }
    if (action === "reconnect") {
      await reconnectMcpServer(id, { itemId, server });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sign-in failed" },
      { status: 409 }
    );
  }
}
