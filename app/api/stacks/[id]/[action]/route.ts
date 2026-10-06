import { NextResponse, type NextRequest } from "next/server";
import { respond } from "@/lib/lumifyhub/http";
import {
  getStack,
  landInBackground,
  pauseStack,
  resumeStack,
  tickSoon,
} from "@/lib/stacks";

type RouteParams = { params: Promise<{ id: string; action: string }> };

const actions: Record<string, (id: string) => unknown> = {
  pause: pauseStack,
  resume: resumeStack,
  land: landInBackground,
  // Look now instead of waiting for the next minute; it runs on its own.
  tick: (id) => {
    tickSoon(id);
    return getStack(id);
  },
};

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id, action } = await params;
  const run = actions[action];
  if (!run)
    return NextResponse.json({ error: "Unknown action" }, { status: 404 });
  return respond(async () => ({ stack: await run(id) }));
}
