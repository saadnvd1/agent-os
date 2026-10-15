import { NextRequest, NextResponse } from "next/server";
import {
  allSince,
  closedSince,
  dismiss,
  openAnomalies,
} from "@/lib/health/store";
import { healthView } from "@/lib/health/view";
import { MIN } from "@/lib/health/types";

const WEEK = 7 * 24 * 60 * MIN;

// GET /api/health/anomalies - what's open, what closed this week and a
// per-check summary. ?count=1 is only the numbers the sidebar dot needs.
export function GET(request: NextRequest) {
  const now = Date.now();
  const view = healthView(
    openAnomalies(),
    closedSince(now - WEEK),
    allSince(now - WEEK)
  );
  if (request.nextUrl.searchParams.has("count"))
    return NextResponse.json({
      open: view.open.length,
      needsYou: view.needsYou,
    });
  return NextResponse.json(view);
}

// PATCH /api/health/anomalies { id, action: "dismiss" } - close it and mute
// that subject for a day.
export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    action?: unknown;
  } | null;
  if (!body || typeof body.id !== "number" || body.action !== "dismiss")
    return NextResponse.json(
      { error: "Send { id, action: 'dismiss' }" },
      { status: 400 }
    );
  if (!dismiss(body.id))
    return NextResponse.json({ error: "No such anomaly" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
