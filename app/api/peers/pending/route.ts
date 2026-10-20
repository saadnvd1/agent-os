import { NextRequest, NextResponse } from "next/server";
import { approverOf } from "@/lib/security/approver";
import { pendingRequests } from "@/lib/peer/pairing";

// GET /api/peers/pending - machines asking to link here, waiting for the
// code, and accepted ones whose second code is still to be typed there. That
// code goes only to a caller that could have accepted.
export function GET(request: NextRequest) {
  return NextResponse.json({
    requests: pendingRequests(Date.now(), {
      withCodes: approverOf(request.headers) !== null,
    }),
  });
}
