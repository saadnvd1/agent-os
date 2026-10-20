import { NextRequest, NextResponse } from "next/server";
import { accountMachines } from "@/lib/peer/machines";

// GET /api/peers/account[?refresh=1] - the other machines on this Connect
// account, whether each is linked here, and whether the plan allows linking.
export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  return NextResponse.json(await accountMachines(refresh));
}
