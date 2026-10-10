import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import {
  configMergeSettings,
  globalMergeSettings,
  mergePolicy,
  projectMergeSettings,
  setProjectMergeSettings,
} from "@/lib/tasks/merge-policy";
import { repoMergeMethods } from "@/lib/tasks/merge-pr";
import { expandHome } from "@/lib/tasks/session";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function state(id: string) {
  const project = getProject(id);
  if (!project || project.is_uncategorized) return null;
  return {
    project,
    body: {
      settings: projectMergeSettings(id),
      config: configMergeSettings(project),
      global: globalMergeSettings(),
      inherited: mergePolicy(project, { inherited: true }),
      effective: mergePolicy(project),
    },
  };
}

// The project's merge settings, what agentos.json and the global settings
// say, the result, and the methods the repository allows (null when
// GitHub can't say; asked only with ?allowed=1, it's a gh call).
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const got = state(id);
  if (!got)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const allowed =
    request.nextUrl.searchParams.get("allowed") === "1"
      ? ((await repoMergeMethods(expandHome(got.project.working_directory)))
          ?.allowed ?? null)
      : null;
  return NextResponse.json({ ...got.body, allowed });
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!state(id))
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  try {
    const { settings } = await request.json();
    setProjectMergeSettings(id, settings);
    return NextResponse.json({ ...state(id)!.body, allowed: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
