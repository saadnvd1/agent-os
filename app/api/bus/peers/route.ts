import { NextRequest, NextResponse } from "next/server";
import { listPeers, resolveTarget } from "@/lib/bus";

// ?ref=<name>: just the session that name reaches, the way aos send would.
export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref");
  if (ref === null) return NextResponse.json({ peers: await listPeers() });
  try {
    const { session, note } = resolveTarget(ref);
    return NextResponse.json({
      peer: { id: session.id, name: session.name },
      note,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
