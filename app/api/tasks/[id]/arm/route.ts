import { refuse } from "@/lib/tasks/contract/authorize";
import { NextRequest, NextResponse } from "next/server";
import { db, type Session } from "@/lib/db";
import { armTask, setArmed } from "@/lib/orchestrator/armed";

// { armed: true } merges the task's PR by itself once every gate passes;
// false takes that back.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const refused = refuse(request, id, "open");
  if (refused) return refused;
  const { armed } = await request.json().catch(() => ({}));
  if (typeof armed !== "boolean")
    return NextResponse.json(
      { error: "armed must be true or false" },
      { status: 400 }
    );
  const task = db
    .prepare(`SELECT * FROM sessions WHERE id = ? AND task_status IS NOT NULL`)
    .get((await params).id) as Session | undefined;
  if (!task)
    return NextResponse.json({ error: "No such task" }, { status: 404 });
  try {
    if (armed) armTask(task);
    else setArmed(task.id, false);
    return NextResponse.json({ success: true, armed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
