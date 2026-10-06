import { NextResponse } from "next/server";
import { listPasskeys, passkeysBootstrapped } from "@/lib/security/passkeys";

// Every passkey, when and where it was registered, and whether the free
// first one has been used.
export async function GET() {
  return NextResponse.json({
    passkeys: listPasskeys(),
    bootstrapped: passkeysBootstrapped(),
  });
}
