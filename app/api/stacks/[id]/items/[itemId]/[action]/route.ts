import { NextResponse, type NextRequest } from "next/server";
import { respond } from "@/lib/lumifyhub/http";
import { dropItem, retryItem, retryRestack } from "@/lib/stacks";

type RouteParams = {
  params: Promise<{ id: string; itemId: string; action: string }>;
};

const actions: Record<string, (id: string, itemId: string) => unknown> = {
  drop: dropItem,
  restack: retryRestack,
  retry: retryItem,
};

export async function POST(_request: NextRequest, { params }: RouteParams) {
  const { id, itemId, action } = await params;
  const run = actions[action];
  if (!run)
    return NextResponse.json({ error: "Unknown action" }, { status: 404 });
  return respond(async () => ({ stack: await run(id, itemId) }));
}
