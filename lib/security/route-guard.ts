/**
 * For actions a stolen device token must not be able to take (adding
 * devices, opening up the network): only this machine or the tailnet.
 */

import { NextResponse, type NextRequest } from "next/server";
import { TRUST_HEADER } from "./auth";

export function requireLocalTrust(request: NextRequest): NextResponse | null {
  const via = request.headers.get(TRUST_HEADER);
  if (via === "loopback" || via === "tailnet") return null;
  return NextResponse.json(
    { error: "Do this on the machine running AgentOS, or over Tailscale." },
    { status: 403 }
  );
}
