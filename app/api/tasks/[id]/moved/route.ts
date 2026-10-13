import { NextRequest, NextResponse } from "next/server";
import { markMoved } from "@/lib/tasks/move";
import { callingDevice } from "@/lib/security/device-me";
import { heldRefusal } from "@/lib/tasks/held";

// POST /api/tasks/:id/moved - the task now runs on the machine named `to`
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const held = heldRefusal(id, callingDevice(request));
  if (held) return NextResponse.json({ error: held }, { status: 403 });
  const { to } = await request.json().catch(() => ({}));
  markMoved(id, String(to || "another machine").slice(0, 100));
  return NextResponse.json({ success: true });
}
