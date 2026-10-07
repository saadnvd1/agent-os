import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { publishPrivate } from "@/lib/project-add";

// POST /api/projects/:id/github - publishes it as a private GitHub repo.
// Only ever on an explicit click.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const project = getProject((await params).id);
  if (!project || project.is_uncategorized)
    return NextResponse.json({ error: "Unknown project" }, { status: 404 });
  try {
    const url = await publishPrivate(
      project.host_id || "local",
      project.working_directory
    );
    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message.trim().split("\n").pop() },
      { status: 400 }
    );
  }
}
