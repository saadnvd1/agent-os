import { NextRequest, NextResponse } from "next/server";
import { subagentModelUsage } from "@/lib/usage/subagents";

// GET /api/usage/subagents?days=7 - calls and tokens by subagent type and
// the model that answered, for the last 1-90 days.
export async function GET(request: NextRequest) {
  const asked = Number(request.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(asked) && asked >= 1 ? Math.min(asked, 90) : 7;
  return NextResponse.json({ days, rows: subagentModelUsage(days) });
}
