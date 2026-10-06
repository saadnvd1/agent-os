import type { NextRequest } from "next/server";
import { respond } from "@/lib/lumifyhub/http";
import { readDoc } from "@/lib/lumifyhub/docs";

type RouteParams = { params: Promise<{ id: string; pageId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id, pageId } = await params;
  return respond(async () => ({ page: await readDoc(id, pageId) }));
}
