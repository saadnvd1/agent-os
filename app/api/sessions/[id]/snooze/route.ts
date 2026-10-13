import { NextResponse } from "next/server";
import {
  SNOOZE_MAX_MS,
  snoozeSession,
  unsnoozeSession,
} from "@/lib/sidebar/shelf-state";

// POST /api/sessions/:id/snooze { until } - hold it on Snoozed until that
// ISO time (the reader's own 9am, worked out on their device); null wakes it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    until?: unknown;
  } | null;
  if (body?.until === undefined)
    return NextResponse.json({ error: "until is required" }, { status: 400 });
  let ok: boolean;
  if (body.until === null) ok = unsnoozeSession(id);
  else {
    const at =
      typeof body.until === "string" ? new Date(body.until) : new Date(NaN);
    const ahead = at.getTime() - Date.now();
    if (Number.isNaN(ahead) || ahead < -60_000 || ahead > SNOOZE_MAX_MS)
      return NextResponse.json(
        { error: "until must be a time within the next 60 days" },
        { status: 400 }
      );
    ok = snoozeSession(id, at);
  }
  if (!ok)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
