import { NextRequest, NextResponse } from "next/server";
import { USAGE_RANGES, type UsageRange } from "@/lib/usage/aggregate";
import { checkRunReport, modelUsage, usageReport } from "@/lib/usage/report";
import { usageWindows } from "@/lib/usage/windows";

// GET /api/usage?range=today|7d|30d - chat spend by day, session and
// workspace, what the orchestrator's reviews cost by PR, the account's
// rolling windows, and spend by model and role in the 5-hour window and the
// last 24 hours
export async function GET(request: NextRequest) {
  const asked = request.nextUrl.searchParams.get("range") as UsageRange | null;
  const range = asked && USAGE_RANGES.includes(asked) ? asked : "7d";
  const windows = await usageWindows();
  return NextResponse.json({
    report: usageReport(range),
    reviews: checkRunReport(range),
    windows,
    models: modelUsage(windows.fiveHour?.resetsIn),
  });
}
