import { NextRequest, NextResponse } from "next/server";
import { doneIdle } from "@/lib/done/bulk";

// POST /api/sessions/done-idle {workspaceId} | {projectId} - done for every
// idle or stopped session there, each judged on its own.
export async function POST(request: NextRequest) {
  try {
    const { workspaceId, projectId } = await request.json();
    const scope =
      typeof workspaceId === "string" && workspaceId
        ? { workspaceId }
        : typeof projectId === "string" && projectId
          ? { projectId }
          : null;
    if (!scope) throw new Error("Say which workspace or project");
    return NextResponse.json(await doneIdle(scope, { by: "direct" }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
