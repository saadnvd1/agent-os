import { NextResponse } from "next/server";
import { pairingOffer } from "@/lib/security/pair-qr";

// POST /api/pair/start - a one-time code for adding a device (trusted callers only)
export async function POST() {
  return NextResponse.json(await pairingOffer());
}
