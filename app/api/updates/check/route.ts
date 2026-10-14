import { NextRequest, NextResponse } from "next/server";
import { approverOf } from "@/lib/security/approver";
import { checkForUpdate } from "@/lib/updates/check";
import { updateView } from "@/lib/updates/view";

// POST /api/updates/check - look now, at most once a minute.
export async function POST(request: NextRequest) {
  const { throttled } = await checkForUpdate({ force: true });
  if (throttled)
    return NextResponse.json(
      { error: "Checked a moment ago.", retryAfter: throttled },
      { status: 429, headers: { "Retry-After": String(throttled) } }
    );
  return NextResponse.json(
    await updateView({ mayUpdate: !!approverOf(request.headers) })
  );
}
