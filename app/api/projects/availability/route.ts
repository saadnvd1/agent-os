import { NextRequest, NextResponse } from "next/server";
import { whyNotHere, type ProjectRef } from "@/lib/tasks/project-ref";

// Another machine's AgentOS asking, before it offers this one for a
// project's session, whether this machine has the project or can clone it.
export async function POST(request: NextRequest) {
  const { project } = await request.json().catch(() => ({}));
  if (
    !project ||
    typeof project !== "object" ||
    typeof project.name !== "string" ||
    typeof project.path !== "string" ||
    (project.remote !== null && typeof project.remote !== "string")
  )
    return NextResponse.json({ error: "Bad project" }, { status: 400 });
  return NextResponse.json({ reason: await whyNotHere(project as ProjectRef) });
}
