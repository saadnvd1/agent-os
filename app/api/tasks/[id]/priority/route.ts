import { NextResponse } from "next/server";
import { setPriority } from "@/lib/tasks/queue";
import { isPriority } from "@/lib/tasks/schedule-types";

// PATCH /api/tasks/:id/priority { priority } - urgent, blocking, normal or
// background, for a queued task or a running one. A queued task keeps its age.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    priority?: unknown;
  } | null;
  if (!isPriority(body?.priority))
    return NextResponse.json(
      { error: "priority is one of: urgent, blocking, normal, background" },
      { status: 400 }
    );
  try {
    setPriority(id, body.priority);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, priority: body.priority });
}
