import { NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { projectMachines } from "@/lib/hosts/project-machines";

// Which linked machines can take a session for this project, and why not
// where one can't: { machines: { [hostId]: reason | null } }.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const project = getProject((await params).id);
  if (!project || project.is_uncategorized)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ machines: await projectMachines(project) });
}
