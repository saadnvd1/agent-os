import { NextRequest, NextResponse } from "next/server";
import { setWorkspaceMode, workspaceMode } from "@/lib/reports/mode";
import { isMode } from "@/lib/reports/types";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/workspaces/:id/mode - the default operating mode of its tasks.
export async function GET(_request: NextRequest, { params }: Ctx) {
  return NextResponse.json({ mode: workspaceMode((await params).id) });
}

// PUT /api/workspaces/:id/mode {mode}
export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { mode } = await request.json().catch(() => ({}));
  if (!isMode(mode))
    return NextResponse.json(
      { error: "mode is manual, assisted or autonomous" },
      { status: 400 }
    );
  setWorkspaceMode(id, mode);
  return NextResponse.json({ mode });
}
