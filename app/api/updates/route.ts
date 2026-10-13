import { NextRequest, NextResponse } from "next/server";
import { approverOf } from "@/lib/security/approver";
import { updateView } from "@/lib/updates/view";

// GET /api/updates - the installed version, the latest one, the update run
// in progress and whether the caller may start one.
export async function GET(request: NextRequest) {
  return NextResponse.json(
    await updateView({ mayUpdate: !!approverOf(request.headers) })
  );
}
