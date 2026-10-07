import { NextRequest, NextResponse } from "next/server";
import {
  archiveSchedule,
  findSchedule,
  scheduleHistory,
  scheduleView,
  updateSchedule,
} from "@/lib/schedules";

type Params = { params: Promise<{ id: string }> };

const failed = (error: unknown, status = 400) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status }
  );

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const schedule = findSchedule((await params).id);
    return NextResponse.json({
      schedule: scheduleView(schedule),
      runs: scheduleHistory(schedule.id),
    });
  } catch (error) {
    return failed(error, 404);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const schedule = updateSchedule((await params).id, await request.json());
    return NextResponse.json({ schedule: scheduleView(schedule) });
  } catch (error) {
    return failed(error);
  }
}

// Archives it: off the list, its history kept.
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    archiveSchedule(findSchedule((await params).id).id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return failed(error, 404);
  }
}
