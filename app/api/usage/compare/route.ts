import { NextRequest, NextResponse } from "next/server";
import { comparisonReport } from "@/lib/usage/compare";

const DAY = 24 * 3600 * 1000;

// GET /api/usage/compare?days=30 (or from=&to= in ms) - Claude-only tasks
// against routed ones: cost and outcomes per provider, and spend per role
// and model.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const now = Date.now();
  const days = Math.min(Math.max(Number(q.get("days")) || 30, 1), 365);
  const to = Number(q.get("to")) || now;
  const from = Number(q.get("from")) || to - days * DAY;
  if (from >= to)
    return NextResponse.json(
      { error: "from must be before to" },
      { status: 400 }
    );
  return NextResponse.json(comparisonReport(from, to));
}
