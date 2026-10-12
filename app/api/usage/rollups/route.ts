import { NextResponse } from "next/server";
import { readUsageConfig } from "@/lib/usage/config";
import { realDeps, nightly, exclusive, usageBusy } from "@/lib/usage/nightly";
import { loadBaseline, SUPPORTING_LABELS } from "@/lib/usage/ratchet";
import { loadRollups, spanOf } from "@/lib/usage/rollup";
import { db } from "@/lib/db";
import { usageWindows } from "@/lib/usage/windows";

// GET /api/usage/rollups - the daily rollups (newest last), their total, the
// ratchet's baseline and thresholds, open alerts, and the account's windows.
export async function GET() {
  const rollups = loadRollups(30);
  const alerts = db
    .prepare(
      `SELECT kind, opened_at AS openedAt, message FROM usage_alerts WHERE cleared_at IS NULL`
    )
    .all();
  return NextResponse.json({
    rollups,
    total: spanOf(rollups),
    baseline: loadBaseline(),
    labels: SUPPORTING_LABELS,
    config: readUsageConfig(),
    alerts,
    windows: await usageWindows(),
  });
}

// POST /api/usage/rollups - run the nightly pass now, in the background.
export async function POST() {
  if (usageBusy()) return NextResponse.json({ running: true }, { status: 202 });
  void exclusive(() => nightly(realDeps)).catch((error) =>
    console.error("[usage] rollup failed:", error)
  );
  return NextResponse.json({ started: true }, { status: 202 });
}
