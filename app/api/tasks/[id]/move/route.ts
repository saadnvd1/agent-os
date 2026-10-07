import { NextRequest, NextResponse } from "next/server";
import { moveTask } from "@/lib/tasks";
import { getProgress } from "@/lib/tasks/move-progress";

// POST /api/tasks/:id/move {hostId} - carry on with it on that machine
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { hostId } = await request.json();
    const session = await moveTask((await params).id, String(hostId || ""));
    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

// GET /api/tasks/:id/move - how far the move running here has got
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return NextResponse.json({ progress: getProgress((await params).id) });
}
