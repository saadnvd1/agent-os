import { NextRequest, NextResponse } from "next/server";
import { listPasskeys } from "@/lib/security/passkeys";
import { relyingParty } from "@/lib/security/presence";

// Every passkey, when and where it was registered, and whether this page
// can use passkeys at all (https or localhost).
export async function GET(request: NextRequest) {
  let host: string | null = null;
  try {
    host = relyingParty(request.headers).rpID;
  } catch {}
  return NextResponse.json({ passkeys: listPasskeys(), host });
}
