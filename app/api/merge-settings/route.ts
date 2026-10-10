import { NextRequest, NextResponse } from "next/server";
import { getAllProjects } from "@/lib/projects";
import {
  DEFAULT_MERGE_POLICY,
  globalMergeSettings,
  mergeOverrides,
  setGlobalMergeSettings,
} from "@/lib/tasks/merge-policy";

// The global merge settings, and the projects whose own setting or
// agentos.json overrides them.
const state = () => ({
  settings: globalMergeSettings(),
  defaults: DEFAULT_MERGE_POLICY,
  overrides: mergeOverrides(getAllProjects()),
});

export async function GET() {
  return NextResponse.json(state());
}

export async function PUT(request: NextRequest) {
  try {
    const { settings } = await request.json();
    setGlobalMergeSettings(settings);
    return NextResponse.json(state());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
