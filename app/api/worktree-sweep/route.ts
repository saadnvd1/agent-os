import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  setGlobalSweepDays,
  setReaperArmed,
  setProjectSweepDays,
  sweepDays,
} from "@/lib/worktree-sweep/settings";
import { requireLocalTrust } from "@/lib/security/route-guard";
import { sweepState } from "@/lib/worktree-sweep/state";

const body = z.union([
  z.object({
    // Null clears the setting: the global one, then the default, applies.
    days: sweepDays.nullable(),
    projectId: z.string().min(1).optional(),
  }),
  z.object({ armed: z.boolean() }),
]);

export async function GET() {
  return NextResponse.json(sweepState());
}

export async function PUT(request: NextRequest) {
  const got = body.safeParse(await request.json().catch(() => null));
  if (!got.success)
    return NextResponse.json(
      {
        error:
          "days must be a whole number from 0 to 365, or null; or armed true or false",
      },
      { status: 400 }
    );
  if ("armed" in got.data) {
    // Turning the removal on is Saad's call, made on this machine or over
    // Tailscale: a stolen device token must not be able to. The orchestrator
    // arms through its sweep_arm tool (a linked machine over ssh to its own
    // loopback), never with a device token. Turning it off stays on the
    // ordinary gate.
    if (got.data.armed) {
      const refused = requireLocalTrust(request);
      if (refused) return refused;
    }
    setReaperArmed(got.data.armed);
    return NextResponse.json(sweepState());
  }
  const { days, projectId } = got.data;
  if (projectId) setProjectSweepDays(projectId, days);
  else setGlobalSweepDays(days);
  return NextResponse.json(sweepState());
}
