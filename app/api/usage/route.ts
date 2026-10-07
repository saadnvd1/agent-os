import { NextRequest, NextResponse } from "next/server";
import { USAGE_RANGES, type UsageRange } from "@/lib/usage/aggregate";
import { usageReport } from "@/lib/usage/report";
import { usageWindows } from "@/lib/usage/windows";

// GET /api/usage?range=today|7d|30d - chat spend by day, session and
// workspace, and the account's rolling windows
export async function GET(request: NextRequest) {
  const asked = request.nextUrl.searchParams.get("range") as UsageRange | null;
  const range = asked && USAGE_RANGES.includes(asked) ? asked : "7d";
  return NextResponse.json({
    report: usageReport(range),
    windows: await usageWindows(),
  });
}
