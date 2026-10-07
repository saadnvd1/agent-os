import { NextResponse } from "next/server";
import { getArtifact, readArtifactHtml } from "@/lib/artifacts/store";
import { ARTIFACT_HEADERS, prepareArtifact } from "@/lib/artifacts/serve";

// GET /api/artifacts/[id] - a page an agent showed, sandboxed
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const artifact = getArtifact(id);
  const html = artifact ? await readArtifactHtml(artifact) : null;
  if (html === null)
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  return new NextResponse(prepareArtifact(html), { headers: ARTIFACT_HEADERS });
}
