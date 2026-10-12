import { NextRequest, NextResponse } from "next/server";
import { startOptions, UnknownProjectError } from "@/lib/start-options";

// GET /api/start-options?projectId= - everything the start form needs in
// one request: agents and their models, the models a task can run on, the
// machines, the project's branches and whether a task plans first. Without
// a project, the options for a scratch chat.
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json(
      await startOptions(request.nextUrl.searchParams.get("projectId") || null)
    );
  } catch (error) {
    if (error instanceof UnknownProjectError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    console.error("Reading start options:", error);
    return NextResponse.json(
      { error: "Couldn't read the start options" },
      { status: 500 }
    );
  }
}
