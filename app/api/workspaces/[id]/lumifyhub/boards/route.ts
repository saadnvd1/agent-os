import type { NextRequest } from "next/server";
import { respond } from "@/lib/lumifyhub/http";
import { listWorkspaceBoards } from "@/lib/lumifyhub/links";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return respond(async () => ({ boards: await listWorkspaceBoards(id) }));
}
