import { NextResponse, type NextRequest } from "next/server";
import { pairingOffer } from "@/lib/security/pair-qr";
import { requireLocalTrust } from "@/lib/security/route-guard";

// POST /api/pair/start - a one-time code for adding a device (trusted callers only)
export async function POST(request: NextRequest) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  return NextResponse.json(await pairingOffer());
}
