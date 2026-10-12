import { NextRequest, NextResponse } from "next/server";
import { db, queries, type Session } from "@/lib/db";
import { taskChecks } from "@/lib/tasks/checks-view";
import { LoopError, localTask } from "@/lib/tasks/loop-error";
import { isMirror } from "@/lib/tasks/remote";

// GET /api/tasks/:id/checks - the PR head's checks, the tail of a failing
// job's log, and the review gate's verdict on the head. ?log=0 leaves the
// logs out. Log and verdict text is untrusted: show it, never run it.
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
      await taskChecks(session, {
        logs: request.nextUrl.searchParams.get("log") !== "0",
      })
    );
  } catch (error) {
    if (error instanceof LoopError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    console.error("Reading a task's checks:", error);
    return NextResponse.json(
      { error: "Couldn't read the task's checks" },
      { status: 500 }
    );
  }
}
