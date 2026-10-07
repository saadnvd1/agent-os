import { NextRequest, NextResponse } from "next/server";
import { findSchedule, runNow } from "@/lib/schedules";

// Run now. The id may also be the schedule's name (for `aos schedule run`).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const schedule = findSchedule((await params).id);
    const run = await runNow(schedule.id);
    return NextResponse.json({
      run,
      schedule: { id: schedule.id, name: schedule.name },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
