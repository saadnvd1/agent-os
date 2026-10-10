import { NextRequest, NextResponse } from "next/server";
import { moveQueued, removeQueued, startQueuedNow } from "@/lib/tasks/queue";

type RouteParams = { params: Promise<{ id: string }> };

const fail = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 409 }
  );

// action "start": start it now, past the limit and its wait; "up"/"down":
// swap it with its neighbour in line.
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { action } = await request.json();
    if (action === "start")
      return NextResponse.json({ outcome: await startQueuedNow(id) });
    if (action === "up" || action === "down") {
      moveQueued(id, action === "up" ? -1 : 1);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    removeQueued((await params).id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return fail(error);
  }
}
