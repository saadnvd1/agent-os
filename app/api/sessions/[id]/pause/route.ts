import { NextResponse } from "next/server";
import {
  PauseRefused,
  pauseViewOf,
  requestPause,
  resumeNow,
  setResumeTime,
} from "@/lib/tasks/pause";

const MAX_AHEAD_MS = 60 * 24 * 3600_000;

function parseUntil(v: unknown): Date | null | "bad" {
  if (v === null) return null;
  const at = typeof v === "string" ? new Date(v) : new Date(NaN);
  const ahead = at.getTime() - Date.now();
  return Number.isNaN(ahead) || ahead < 0 || ahead > MAX_AHEAD_MS ? "bad" : at;
}

const fail = (error: unknown) =>
  NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: error instanceof PauseRefused ? 409 : 500 }
  );

// POST /api/sessions/:id/pause { until, mode } - pauses it: until an ISO time
// (the reader's own 9am, worked out on their device), or null for until it is
// resumed. mode "turn" (the default) stops it at the end of its step; "now"
// interrupts the step. Refused with 409 and the reason when it can't be.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    until?: unknown;
    mode?: unknown;
  } | null;
  if (body?.until === undefined)
    return NextResponse.json({ error: "until is required" }, { status: 400 });
  const until = parseUntil(body.until);
  if (until === "bad")
    return NextResponse.json(
      { error: "until must be a time within the next 60 days" },
      { status: 400 }
    );
  if (body.mode !== undefined && body.mode !== "turn" && body.mode !== "now")
    return NextResponse.json(
      { error: 'mode is "turn" or "now"' },
      { status: 400 }
    );
  try {
    requestPause(id, { until, mode: body.mode ?? "turn", by: "person" });
    return NextResponse.json({ pause: pauseViewOf(id) }, { status: 202 });
  } catch (error) {
    return fail(error);
  }
}

// PATCH /api/sessions/:id/pause { until } - changes when it resumes.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    until?: unknown;
  } | null;
  if (body?.until === undefined)
    return NextResponse.json({ error: "until is required" }, { status: 400 });
  const until = parseUntil(body.until);
  if (until === "bad")
    return NextResponse.json(
      { error: "until must be a time within the next 60 days" },
      { status: 400 }
    );
  try {
    setResumeTime(id, until);
    return NextResponse.json({ pause: pauseViewOf(id) });
  } catch (error) {
    return fail(error);
  }
}

// DELETE /api/sessions/:id/pause - resume now (past the task limit), or keep
// running when it is still pausing.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await resumeNow(id, "person");
    return NextResponse.json({ pause: pauseViewOf(id) });
  } catch (error) {
    return fail(error);
  }
}
