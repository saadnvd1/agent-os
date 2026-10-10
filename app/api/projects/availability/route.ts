import { NextRequest, NextResponse } from "next/server";
import { isProjectRef, whyNotHere } from "@/lib/tasks/project-ref";

// Another machine's AgentOS asking, before it offers this one for a
// project's session, whether this machine has the project or can clone it.
export async function POST(request: NextRequest) {
  const { project } = await request.json().catch(() => ({}));
  if (!isProjectRef(project))
    return NextResponse.json({ error: "Bad project" }, { status: 400 });
  return NextResponse.json({ reason: await whyNotHere(project) });
}
