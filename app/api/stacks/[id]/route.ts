import type { NextRequest } from "next/server";
import { respond } from "@/lib/lumifyhub/http";
import { getStack } from "@/lib/stacks";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return respond(() => ({ stack: getStack(id) }));
}
