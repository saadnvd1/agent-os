import { NextResponse } from "next/server";
import { z } from "zod";
import { compareVersions } from "@/lib/artifacts/compare";
import { getSession } from "@/lib/session-artifacts/collect";

const Query = z.object({
  to: z.string().min(1).max(64),
  mode: z.enum(["changes", "source"]).default("changes"),
});

// GET /api/sessions/[id]/artifacts/[artifactId]/compare?to=<id>&mode= - what
// changed between two versions of one page: the visible text (changes) or the
// HTML (source). Both versions must be this session's, of the same page.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  const { id, artifactId } = await params;
  const query = Query.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!query.success)
    return NextResponse.json(
      { error: "Name the version: ?to=" },
      { status: 400 }
    );
  if (!getSession(id))
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const result = await compareVersions(
    id,
    artifactId,
    query.data.to,
    query.data.mode
  );
  if (!result.ok)
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  return NextResponse.json(result);
}
