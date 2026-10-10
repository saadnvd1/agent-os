import { NextRequest, NextResponse } from "next/server";
import { inFlight } from "@/lib/busy";
import { requireLocalTrust } from "@/lib/security/route-guard";

// GET /api/busy - work a restart would cut off; scripts/redeploy waits
// for it to finish before restarting
export async function GET(request: NextRequest) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  const work = inFlight();
  return NextResponse.json({ ...work, busy: work.reviews + work.setups > 0 });
}
