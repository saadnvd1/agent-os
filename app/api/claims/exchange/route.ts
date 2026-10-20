import { NextRequest, NextResponse } from "next/server";
import { acceptExchange, answerExchange } from "@/lib/claims/exchange";
import { claimsShared } from "@/lib/claims/machine";
import { rememberPeer } from "@/lib/claims/peers";
import { exchangeBody } from "@/lib/claims/types";
import { pinForHost } from "@/lib/peer/links";
import { PEER_HEADER, TRUST_HEADER } from "@/lib/security/auth";
import { readCapped } from "@/lib/security/read-capped";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;

// POST /api/claims/exchange - a linked machine sends its claims and gets
// ours back. Paths and one-line goals only; the device-token gate applies.
export async function POST(request: NextRequest) {
  // A Connect peer arrives as `peer` trust naming its pin. The RPC layer has
  // already refused suspended and unknown ones; a pin suspended since is
  // refused here too.
  let viaHost: string | null = null;
  if (request.headers.get(TRUST_HEADER) === "peer") {
    const hostId = request.headers.get(PEER_HEADER);
    if (!hostId || pinForHost(hostId)?.state !== "active")
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    viaHost = hostId;
  }
  const raw = await readCapped(request, MAX_BYTES);
  if (raw === null)
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Not JSON" }, { status: 400 });
  }
  const body = exchangeBody.safeParse(json);
  if (!body.success)
    return NextResponse.json({ error: "Bad claims" }, { status: 400 });
  if (viaHost && claimsShared()) rememberPeer(viaHost, body.data.machine.id);
  acceptExchange(body.data, viaHost);
  return NextResponse.json(answerExchange(body.data));
}
