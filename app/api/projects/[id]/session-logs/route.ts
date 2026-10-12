import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { DEFAULT_ROOT } from "@/lib/session-logs/folder";
import { listLogs, logFolder, setLogFolder } from "@/lib/session-logs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function state(id: string) {
  return {
    folder: logFolder(id),
    defaultFolder: DEFAULT_ROOT(),
    logs: listLogs({ projectId: id }, 100),
  };
}

// The project's merged-task logs, newest first, and its log folder setting.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!getProject(id))
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(state(id));
}

// A folder inside the project's repository is refused with the reason.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!getProject(id))
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  try {
    const { folder } = await request.json();
    setLogFolder(id, typeof folder === "string" ? folder : null);
    return NextResponse.json(state(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
