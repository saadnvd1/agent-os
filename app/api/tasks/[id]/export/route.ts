import { NextRequest, NextResponse } from "next/server";
import { exportOrResume } from "@/lib/tasks/move";

// POST /api/tasks/:id/export - stop the agent, push, hand over the task.
// The caller confirms with /moved, or restarts it here with /resume; if it
// fails here, it resumes here.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { to } = await request.json().catch(() => ({}));
    const bundle = await exportOrResume(
      (await params).id,
      String(to || "another machine").slice(0, 100)
    );
    return NextResponse.json({ bundle });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
