import type { NextRequest } from "next/server";
import { respond } from "@/lib/lumifyhub/http";
import { lumifyHubId } from "@/lib/lumifyhub/ids";
import { readDoc, sessionWorkspace } from "@/lib/lumifyhub/docs";

type RouteParams = { params: Promise<{ pageId: string }> };

// `aos doc <id>`.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { pageId } = await params;
  const session = request.nextUrl.searchParams.get("session");
  return respond(async () => ({
    page: await readDoc(
      sessionWorkspace(session).id,
      lumifyHubId(pageId, "page id")
    ),
  }));
}
