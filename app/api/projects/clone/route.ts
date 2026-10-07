import { NextRequest, NextResponse } from "next/server";
import { startClone } from "@/lib/project-add";

// POST /api/projects/clone - starts cloning { url } into { parent } on a
// machine; GET /api/projects/clone/:job follows it.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const job = startClone(
      typeof body.hostId === "string" ? body.hostId : "local",
      String(body.parent ?? "~"),
      String(body.url ?? "").trim()
    );
    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
