import { NextRequest, NextResponse } from "next/server";
import { AlreadyRunning, startRun } from "@/lib/recipes";
import { failed, resolveRecipe } from "@/lib/recipes/api";
import { BrakeRefused } from "@/lib/orchestrator/brakes";

type Params = { params: Promise<{ id: string }> };

// Run now. From the UI it is Saad's (manual); `aos recipe run` sends `from`,
// the session asking, and goes through the brakes like any agent's start.
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const body = await request.json().catch(() => ({}));
    const recipe = resolveRecipe(
      (await params).id,
      request.nextUrl.searchParams.get("workspace")
    );
    const from = typeof body.from === "string" ? body.from : null;
    const { run, queued } = await startRun(recipe.id, {
      trigger: from ? "cli" : "manual",
      actorSessionId: from,
      note: typeof body.note === "string" ? body.note : null,
      requestId: typeof body.requestId === "string" ? body.requestId : null,
    });
    return NextResponse.json({ run, queued }, { status: 201 });
  } catch (error) {
    if (error instanceof AlreadyRunning)
      return NextResponse.json(
        { error: "It's already running", liveRun: error.run },
        { status: 409 }
      );
    if (error instanceof BrakeRefused)
      return NextResponse.json({ error: error.message }, { status: 429 });
    return failed(error);
  }
}
