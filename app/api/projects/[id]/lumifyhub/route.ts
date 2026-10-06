import type { NextRequest } from "next/server";
import { body, respond } from "@/lib/lumifyhub/http";
import { lumifyHubId } from "@/lib/lumifyhub/ids";
import { linkProjectBoard, unlinkProjectBoard } from "@/lib/lumifyhub/links";

type RouteParams = { params: Promise<{ id: string }> };

// { boardId } links an existing board in the workspace; { create: true }
// makes one named after the project (or `title`).
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const input = await body<{ boardId: string; create: boolean; title: string }>(
    request
  );
  return respond(async () => ({
    project: await linkProjectBoard(
      id,
      input.create
        ? { create: true, title: input.title }
        : { boardId: lumifyHubId(input.boardId, "board id") }
    ),
  }));
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return respond(() => {
    unlinkProjectBoard(id);
    return { success: true };
  });
}
