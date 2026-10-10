import { NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { projectRef } from "@/lib/tasks/project-ref";
import { projectOnPeers } from "@/lib/hosts/peer-actions";
import { linkedHostIds } from "@/lib/hosts/remote-api";

// Which linked machines can take a session for this project, and why not
// where one can't: { machines: { [hostId]: reason | null } }.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const project = getProject((await params).id);
  if (!project || project.is_uncategorized)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if ((project.host_id || "local") !== "local")
    return NextResponse.json({ machines: {} });
  try {
    return NextResponse.json({
      machines: await projectOnPeers(await projectRef(project)),
    });
  } catch (error) {
    // A project outside the home folder has no place on another machine.
    const reason = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      machines: Object.fromEntries(
        [...linkedHostIds()].map((id) => [id, reason])
      ),
    });
  }
}
