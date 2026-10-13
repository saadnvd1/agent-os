import { NextRequest, NextResponse } from "next/server";
import { runDoctor } from "@/lib/doctor/checks";

// Whether this machine has what AgentOS needs, and how to fix what it lacks.
export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.has("fresh");
  return NextResponse.json({ checks: await runDoctor(fresh) });
}
