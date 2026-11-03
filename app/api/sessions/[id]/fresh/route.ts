import { NextResponse } from "next/server";
import { queries, db, type Session } from "@/lib/db";
import { FreshRefusal, freshStartChat } from "@/lib/chat/runner";

// POST /api/sessions/:id/fresh - start the agent's conversation over (the
// path the context threshold takes, lib/chat/refresh): now if it's idle,
// else at the next turn boundary. Only for chats whose state lives outside
// the conversation: an orchestrator, or a task with a brief.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = queries.getSession(db).get(id) as Session | undefined;
  if (!session)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.role !== "orchestrator" && !session.task_brief)
    return NextResponse.json(
      { error: "Only an orchestrator or a task can start fresh" },
      { status: 400 }
    );
  try {
    return NextResponse.json({ when: await freshStartChat(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: error instanceof FreshRefusal ? 409 : 500 }
    );
  }
}
