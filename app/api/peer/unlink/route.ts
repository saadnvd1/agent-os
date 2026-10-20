import { NextRequest, NextResponse } from "next/server";
import { PEER_HEADER, TRUST_HEADER } from "@/lib/security/auth";
import { getHost } from "@/lib/hosts";
import { unlinkedByPeer } from "@/lib/peer/links";

export const dynamic = "force-dynamic";

// POST /api/peer/unlink - a linked machine unlinked this one. Reached only
// through its signed envelope (lib/peer/rpc-server.ts), which the gate turns
// into `peer` trust naming the host it's pinned to; nothing else may call it.
export function POST(request: NextRequest) {
  const hostId = request.headers.get(PEER_HEADER);
  if (request.headers.get(TRUST_HEADER) !== "peer" || !hostId)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const name = getHost(hostId)?.name ?? "the other machine";
  return NextResponse.json({ unlinked: unlinkedByPeer(hostId, name) });
}
