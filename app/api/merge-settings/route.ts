import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_MERGE_POLICY,
  globalMergeSettings,
  setGlobalMergeSettings,
} from "@/lib/tasks/merge-policy";

// The global merge settings; a project or its agentos.json can override them.
export async function GET() {
  return NextResponse.json({
    settings: globalMergeSettings(),
    defaults: DEFAULT_MERGE_POLICY,
  });
}

export async function PUT(request: NextRequest) {
  try {
    const { settings } = await request.json();
    return NextResponse.json({
      settings: setGlobalMergeSettings(settings),
      defaults: DEFAULT_MERGE_POLICY,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
