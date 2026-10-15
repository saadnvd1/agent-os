import { NextRequest, NextResponse } from "next/server";
import { db, queries, type Session } from "@/lib/db";
import { taskDiff } from "@/lib/tasks/diff";
import { LoopError, localTask } from "@/lib/tasks/loop-error";
import { isMirror } from "@/lib/tasks/contract/start";

// GET /api/tasks/:id/diff - the task's whole change, base to head: a file
// list with status and line counts; with ?file=<path>, that file's patch.
// Sizes are capped and say "truncated" when a cap was hit.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = localTask(
      queries.getSession(db).get(id) as Session | undefined,
      isMirror
    );
    return NextResponse.json(
      await taskDiff(session, request.nextUrl.searchParams.get("file"))
    );
  } catch (error) {
    if (error instanceof LoopError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    console.error("Reading a task's diff:", error);
    return NextResponse.json(
      { error: "Couldn't read the task's change" },
      { status: 500 }
    );
  }
}
