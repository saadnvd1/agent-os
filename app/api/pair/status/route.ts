import { NextRequest, NextResponse } from "next/server";
import { pairingStatus } from "@/lib/security/pairing";

// GET /api/pair/status?code= - has the new device claimed it yet
export async function GET(request: NextRequest) {
  return NextResponse.json(
    pairingStatus(request.nextUrl.searchParams.get("code") ?? "")
  );
}
