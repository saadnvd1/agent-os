import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { fail, text } from "@/lib/fork/api";
import { startFork } from "@/lib/fork/start";
import { DELIVERY_MODES } from "@/lib/fork/options";

// Starts forks of a session: `from` is the session asking (an agent's `aos
// fork`); a person's tap names it as `session`.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const agent = text(body.from);
    const parentId = agent ?? text(body.session);
    if (!parentId) throw new Error("Which session to fork?");
    const instructions = Array.isArray(body.instructions)
      ? body.instructions.filter((t: unknown) => typeof t === "string")
      : [];
    const delivery = DELIVERY_MODES.find((d) => d === body.delivery);
    const started = startFork({
      parentId,
      requestId: text(body.requestId) ?? randomUUID(),
      instructions,
      labels: Array.isArray(body.labels) ? body.labels : undefined,
      worktree: body.worktree === true,
      startedBy: agent ? "agent" : "user",
      delivery,
    });
    return NextResponse.json(started, { status: started.repeat ? 200 : 201 });
  } catch (error) {
    return fail(error);
  }
}
