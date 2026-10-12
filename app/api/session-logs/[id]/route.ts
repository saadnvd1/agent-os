import { NextRequest, NextResponse } from "next/server";
import { getLog, headerOf } from "@/lib/session-logs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// One task's log: its header fields and the markdown.
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const row = getLog(id);
  if (!row)
    return NextResponse.json(
      { error: "No log for this task" },
      { status: 404 }
    );
  return NextResponse.json({ header: headerOf(row), markdown: row.markdown });
}
