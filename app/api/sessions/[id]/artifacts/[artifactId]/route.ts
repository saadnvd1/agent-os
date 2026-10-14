import { NextResponse } from "next/server";
import { peerLinkOf } from "@/lib/hosts/peer-actions";
import { collectArtifacts, getSession } from "@/lib/session-artifacts/collect";
import { peerContent } from "@/lib/session-artifacts/peer";
import { artifactContent } from "@/lib/session-artifacts/serve";

// GET /api/sessions/[id]/artifacts/[artifactId] - one artifact's content.
// By id only: a path the client sends is never read.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; artifactId: string }> }
) {
  const { id, artifactId } = await params;
  const session = getSession(id);
  if (!session)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const link = peerLinkOf(session);
  const content = link
    ? await peerContent(link, id, artifactId)
    : await (async () => {
        const entry = (await collectArtifacts(session)).find(
          (e) => e.artifact.id === artifactId
        );
        return entry
          ? artifactContent(session, entry)
          : ({ ok: false, status: 404, error: "Not found" } as const);
      })();
  if (!content.ok)
    return NextResponse.json(
      { error: content.error },
      { status: content.status }
    );
  return new NextResponse(content.body, { headers: content.headers });
}
