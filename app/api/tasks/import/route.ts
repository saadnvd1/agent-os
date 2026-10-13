import { NextRequest, NextResponse } from "next/server";
import { callingDevice } from "@/lib/security/device-me";
import { importTask } from "@/lib/tasks/import";
import { MAX_BUNDLE_BYTES, statusFor } from "@/lib/tasks/move-bundle";

// POST /api/tasks/import - a task arriving from another machine (its bundle)
export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > MAX_BUNDLE_BYTES)
    return NextResponse.json(
      { error: "The task is too large to move, or its size wasn't given" },
      { status: 413 }
    );
  try {
    const bundle = await request.json();
    // An orchestrator's task is held for the device that sent it, which
    // only a paired device is.
    const holder = callingDevice(request);
    if (bundle?.orchestrated && !holder)
      return NextResponse.json(
        { error: "An orchestrator's task comes only from a paired machine" },
        { status: 403 }
      );
    const session = await importTask(bundle, { holder });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: statusFor(error) });
  }
}
