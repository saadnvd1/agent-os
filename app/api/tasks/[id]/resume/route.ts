import { NextRequest, NextResponse } from "next/server";
import { resumeTask } from "@/lib/tasks/move";

// POST /api/tasks/:id/resume - start its agent again on its conversation
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await resumeTask((await params).id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
