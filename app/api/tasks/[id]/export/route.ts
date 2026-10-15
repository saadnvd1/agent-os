import { NextRequest, NextResponse } from "next/server";
import { exportOrResume } from "@/lib/tasks/move";
import { callingDevice } from "@/lib/security/device-me";
import { heldRefusal, planWaitRefusal } from "@/lib/tasks/held";

// POST /api/tasks/:id/export - stop the agent, push, hand over the task.
// The caller confirms with /moved, or restarts it here with /resume; if it
// fails here, it resumes here.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const device = callingDevice(request);
  const held = heldRefusal(id, device) ?? planWaitRefusal(id, device);
  if (held) return NextResponse.json({ error: held }, { status: 403 });
  try {
    const { to } = await request.json().catch(() => ({}));
    const bundle = await exportOrResume(
      id,
      String(to || "another machine").slice(0, 100)
    );
    return NextResponse.json({ bundle });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
