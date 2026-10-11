import { NextRequest, NextResponse } from "next/server";
import { resumeOnModel } from "@/lib/models/resume";

// POST /api/tasks/:id/model {model, message?} - resume the task on another
// model ("provider/model" or a map of role to one), keeping its
// conversation and worktree.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { model, message } = await request.json().catch(() => ({}));
  try {
    const result = await resumeOnModel(
      (await params).id,
      model,
      typeof message === "string" && message.trim() ? message : undefined
    );
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
