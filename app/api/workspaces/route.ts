import { NextRequest, NextResponse } from "next/server";
import { createWorkspace, listWorkspaces } from "@/lib/workspaces";

export async function GET() {
  return NextResponse.json({ workspaces: listWorkspaces() });
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    const workspace = createWorkspace(String(name || ""));
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
