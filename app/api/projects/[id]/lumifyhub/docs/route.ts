import type { NextRequest } from "next/server";
import { body, respond } from "@/lib/lumifyhub/http";
import { publishedDocs, publishFile } from "@/lib/lumifyhub/publish";

type RouteParams = { params: Promise<{ id: string }> };

// The project's repo files published as pages.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return respond(() => ({ docs: publishedDocs(id) }));
}

// { path }: publish that markdown file, or update the page it became.
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const input = await body<{ path: string }>(request);
  return respond(async () => ({
    doc: await publishFile(id, input.path ?? ""),
  }));
}
