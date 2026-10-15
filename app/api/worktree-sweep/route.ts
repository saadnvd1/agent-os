import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  setGlobalSweepDays,
  setProjectSweepDays,
  sweepDays,
} from "@/lib/worktree-sweep/settings";
import { sweepState } from "@/lib/worktree-sweep/state";

const body = z.object({
  // Null clears the setting: the global one, then the default, applies.
  days: sweepDays.nullable(),
  projectId: z.string().min(1).optional(),
});

export async function GET() {
  return NextResponse.json(sweepState());
}

export async function PUT(request: NextRequest) {
  const got = body.safeParse(await request.json().catch(() => null));
  if (!got.success)
    return NextResponse.json(
      { error: "days must be a whole number from 0 to 365, or null" },
      { status: 400 }
    );
  const { days, projectId } = got.data;
  if (projectId) setProjectSweepDays(projectId, days);
  else setGlobalSweepDays(days);
  return NextResponse.json(sweepState());
}
