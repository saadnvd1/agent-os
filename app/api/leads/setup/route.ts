import { NextRequest, NextResponse } from "next/server";
import { leadSetup, SetupQuery } from "@/lib/leads/setup";

// What the "Add leads" sheet offers for one workspace.
export async function GET(request: NextRequest) {
  const parsed = SetupQuery.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success)
    return NextResponse.json({ error: "Give a workspaceId" }, { status: 400 });
  const setup = leadSetup(parsed.data.workspaceId);
  if (!setup)
    return NextResponse.json({ error: "Unknown workspace" }, { status: 404 });
  return NextResponse.json({ setup });
}
