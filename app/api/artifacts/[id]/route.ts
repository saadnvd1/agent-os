import { NextResponse } from "next/server";
import {
  getArtifact,
  latestVersion,
  readArtifactHtml,
} from "@/lib/artifacts/store";
import { ARTIFACT_HEADERS, prepareArtifact } from "@/lib/artifacts/serve";

// GET /api/artifacts/[id] - a page an agent showed, sandboxed. That exact
// version, or with ?v=latest the page's newest.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const asked = getArtifact(id);
  const artifact =
    asked && new URL(request.url).searchParams.get("v") === "latest"
      ? latestVersion(asked.page_id)
      : asked;
  const html = artifact ? await readArtifactHtml(artifact) : null;
  if (html === null)
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  return new NextResponse(prepareArtifact(html), { headers: ARTIFACT_HEADERS });
}
