import { NextResponse } from "next/server";
import { artifactActions } from "@/lib/artifacts/actions";
import { pdfAvailable } from "@/lib/share/pdf";
import { peerLinkOf } from "@/lib/hosts/peer-actions";
import { collectArtifacts, getSession } from "@/lib/session-artifacts/collect";
import { peerArtifacts } from "@/lib/session-artifacts/peer";

// GET /api/sessions/[id]/artifacts - everything the session made: its plan,
// files, pages, images, job logs, PR, recipe run and log
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = getSession(id);
  if (!session)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const link = peerLinkOf(session);
  if (link) {
    try {
      return NextResponse.json({
        artifacts: await peerArtifacts(link, id),
        host: link.hostName,
      });
    } catch {
      return NextResponse.json({
        artifacts: [],
        host: link.hostName,
        unreachable: true,
      });
    }
  }
  const entries = await collectArtifacts(session);
  const ctx = { pdf: await pdfAvailable() };
  return NextResponse.json({
    artifacts: entries.map((e) => ({
      ...e.artifact,
      actions: artifactActions(e.artifact, ctx),
    })),
  });
}
