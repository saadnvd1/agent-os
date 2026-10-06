import type { NextRequest } from "next/server";
import { respond } from "@/lib/lumifyhub/http";
import { listDocs } from "@/lib/lumifyhub/docs";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const query = request.nextUrl.searchParams.get("q") ?? "";
  return respond(async () => ({ pages: await listDocs(id, query) }));
}
