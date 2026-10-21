import { NextRequest, NextResponse } from "next/server";
import { refuse } from "@/lib/tasks/contract/authorize";
import { modeOf, setTaskMode } from "@/lib/reports/mode";
import { isMode } from "@/lib/reports/types";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/tasks/:id/mode - the operating mode in force and where it comes from.
export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const refused = refuse(request, id, "open");
  if (refused) return refused;
  return NextResponse.json(modeOf(id));
}

// PUT /api/tasks/:id/mode {mode} - this task's override; null follows its workspace.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const refused = refuse(request, id, "plan");
  if (refused) return refused;
  const { mode } = await request.json().catch(() => ({}));
  if (mode !== null && !isMode(mode))
    return NextResponse.json(
      { error: "mode is manual, assisted, autonomous or null" },
      { status: 400 }
    );
  setTaskMode(id, mode);
  return NextResponse.json(modeOf(id));
}
