import { NextRequest, NextResponse } from "next/server";
import {
  checkInInput,
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
    const body = await request.json();
    // From the CLI: a session by name and an interval.
    const input =
      body.session !== undefined
        ? checkInInput({
            session: String(body.session),
            from: body.from ? String(body.from) : null,
            every: body.every,
            cron: body.cron,
            prompt: String(body.prompt ?? ""),
            name: body.name,
            timezone: body.timezone,
          })
        : body;
    const schedule = createSchedule(input);
    return NextResponse.json(
      { schedule: scheduleView(schedule) },
      { status: 201 }
    );
  } catch (error) {
    return failed(error);
  }
}
