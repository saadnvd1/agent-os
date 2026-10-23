import { NextResponse, type NextRequest } from "next/server";
import { browserMachine } from "@/lib/machines/browser";
import { thisMachine } from "@/lib/machines/identity";
import { allHostInfo } from "@/lib/machines/remote";
import { REMOTE_HEADER, TRUST_HEADER } from "@/lib/security/auth";

export const dynamic = "force-dynamic";

// Which machine this browser is on, when the connection says.
export function GET(request: NextRequest) {
  return NextResponse.json(
    browserMachine(
      request.headers.get(TRUST_HEADER),
      request.headers.get(REMOTE_HEADER),
      thisMachine().addresses,
      allHostInfo().map((i) => ({
        hostId: i.hostId,
        addresses: i.addresses,
      }))
    )
  );
}
