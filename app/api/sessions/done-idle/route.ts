import { NextRequest, NextResponse } from "next/server";
import { doneIdle, previewIdle, type DoneScope } from "@/lib/done/bulk";

function scopeFrom(v: { workspaceId?: unknown; projectId?: unknown }) {
  const { workspaceId, projectId } = v;
  if (typeof workspaceId === "string" && workspaceId) return { workspaceId };
  if (typeof projectId === "string" && projectId) return { projectId };
  throw new Error("Say which workspace or project");
}

const failed = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 400 }
  );

// GET ?workspaceId= | ?projectId= - what a clean-up would do with each
// idle session, changing nothing.
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams;
    const scope: DoneScope = scopeFrom({
      workspaceId: q.get("workspaceId"),
      projectId: q.get("projectId"),
    });
    return NextResponse.json({ rows: await previewIdle(scope) });
  } catch (error) {
    return failed(error);
  }
}

// POST {workspaceId} | {projectId} - done for every idle or stopped session
// there, each judged on its own. Never merges.
export async function POST(request: NextRequest) {
  try {
    const scope = scopeFrom(await request.json());
    return NextResponse.json(await doneIdle(scope, { by: "direct" }));
  } catch (error) {
    return failed(error);
  }
}
