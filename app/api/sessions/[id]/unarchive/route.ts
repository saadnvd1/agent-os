import { NextResponse } from "next/server";
import { unarchiveSession } from "@/lib/done/archive";
import { db, queries, type Session } from "@/lib/db";
import { peerSessionLink, unarchiveOnPeer } from "@/lib/hosts/peer-actions";

// POST /api/sessions/:id/unarchive - back into the sidebar.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const row = queries.getSession(db).get(id) as Session | undefined;
    const peer = row && peerSessionLink(row);
    const session = peer
      ? await unarchiveOnPeer(peer, row)
      : unarchiveSession(id);
    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
