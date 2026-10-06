import { NextResponse } from "next/server";
import { orchestratorOverview } from "@/lib/orchestrator/overview";

// Each workspace's orchestrator at a glance: open asks, paused, in review.
export async function GET() {
  return NextResponse.json({ workspaces: orchestratorOverview() });
}
