import { NextResponse } from "next/server";
import { pendingRequests } from "@/lib/peer/pairing";

// GET /api/peers/pending - machines asking to link here, waiting for the code.
export function GET() {
  return NextResponse.json({ requests: pendingRequests() });
}
