import type { NextRequest } from "next/server";
import { body, respond } from "@/lib/lumifyhub/http";
import { linkWorkspace, unlinkWorkspace } from "@/lib/lumifyhub/links";

type RouteParams = { params: Promise<{ id: string }> };

// { lhWorkspaceId } links an existing LumifyHub workspace; { create: true }
// makes one named after this workspace (or `name`).
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const input = await body<{
    lhWorkspaceId: string;
    create: boolean;
    name: string;
  }>(request);
  return respond(async () => ({
    workspace: await linkWorkspace(
      id,
      input.create
        ? { create: true, name: input.name }
        : { lhWorkspaceId: input.lhWorkspaceId ?? "" }
    ),
  }));
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  return respond(() => {
    unlinkWorkspace(id);
    return { success: true };
  });
}
