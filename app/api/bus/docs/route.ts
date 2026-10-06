import type { NextRequest } from "next/server";
import { body, respond } from "@/lib/lumifyhub/http";
import { createDoc, listDocs, sessionWorkspace } from "@/lib/lumifyhub/docs";

// `aos docs`: pages in the linked workspace of the session's project.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return respond(async () => {
    const workspace = sessionWorkspace(params.get("session"));
    return { pages: await listDocs(workspace.id, params.get("q") ?? "") };
  });
}

// `aos doc new`: { session, title, content }.
export async function POST(request: NextRequest) {
  const input = await body<{
    session: string;
    title: string;
    content: string;
  }>(request);
  return respond(async () => {
    const workspace = sessionWorkspace(input.session ?? null);
    return { page: await createDoc(workspace.id, input) };
  });
}
