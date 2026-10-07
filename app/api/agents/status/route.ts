import { NextRequest, NextResponse } from "next/server";
import { probeAgents } from "@/lib/agents/probe";

// Which agent CLIs this machine has, and which need a sign-in first.
export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.has("fresh");
  return NextResponse.json({ agents: await probeAgents(fresh) });
}
