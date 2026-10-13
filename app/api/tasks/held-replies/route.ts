import { NextRequest, NextResponse } from "next/server";
import { callingDevice } from "@/lib/security/device-me";
import { ackReplies, pendingReplies } from "@/lib/bus/held-reply";

// GET /api/tasks/held-replies - what the tasks this device moved here have
// said to their orchestrator, for it to deliver there. Only that device's.
export async function GET(request: NextRequest) {
  const device = callingDevice(request);
  if (!device)
    return NextResponse.json(
      { error: "Needs a paired device" },
      { status: 403 }
    );
  return NextResponse.json({ messages: pendingReplies(device) });
}

// POST { ids } - those are delivered; they are not offered again.
export async function POST(request: NextRequest) {
  const device = callingDevice(request);
  if (!device)
    return NextResponse.json(
      { error: "Needs a paired device" },
      { status: 403 }
    );
  const { ids } = await request.json().catch(() => ({}));
  const list = (Array.isArray(ids) ? ids : []).filter((n): n is number =>
    Number.isSafeInteger(n)
  );
  ackReplies(device, list.slice(0, 200));
  return NextResponse.json({ success: true });
}
