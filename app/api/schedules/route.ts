import { NextRequest, NextResponse } from "next/server";
import {
  createSchedule,
  listScheduleViews,
  scheduleView,
} from "@/lib/schedules";

const failed = (error: unknown, status = 400) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status }
  );

export async function GET(request: NextRequest) {
  const workspace = request.nextUrl.searchParams.get("workspace");
  return NextResponse.json({ schedules: listScheduleViews(workspace) });
}

export async function POST(request: NextRequest) {
  try {
    const schedule = createSchedule(await request.json());
    return NextResponse.json(
      { schedule: scheduleView(schedule) },
      { status: 201 }
    );
  } catch (error) {
    return failed(error);
  }
}
