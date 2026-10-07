import { NextRequest, NextResponse } from "next/server";
import { importTask } from "@/lib/tasks/import";
import { MAX_BUNDLE_BYTES } from "@/lib/tasks/move-bundle";

// POST /api/tasks/import - a task arriving from another machine (its bundle)
export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length"));
  if (!Number.isFinite(length) || length <= 0 || length > MAX_BUNDLE_BYTES)
    return NextResponse.json(
      { error: "The task is too large to move, or its size wasn't given" },
      { status: 413 }
    );
  try {
    const session = await importTask(await request.json());
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
