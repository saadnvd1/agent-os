import { NextRequest, NextResponse } from "next/server";
import { listPeers, resolveHeldOrchestrator, resolveTarget } from "@/lib/bus";

// ?ref=<name>: just the session that name reaches, the way aos send would.
export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref");
  // from: the asking session, which a held task needs for its orchestrator.
  const from = request.nextUrl.searchParams.get("from") ?? "";
  if (ref === null)
    return NextResponse.json({ peers: await listPeers(from || undefined) });
  const held = from ? resolveHeldOrchestrator(from, ref) : null;
  if (held)
    return NextResponse.json({ peer: { id: held.id, name: held.name } });
  try {
    const { session, note } = resolveTarget(ref, from || null);
    return NextResponse.json({
      peer: { id: session.id, name: session.name },
      note,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
