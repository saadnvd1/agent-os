import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  setGlobalSweepDays,
  setReaperArmed,
  setProjectSweepDays,
  sweepDays,
} from "@/lib/worktree-sweep/settings";
import { requireLocalTrust } from "@/lib/security/route-guard";
import { db, type Session } from "@/lib/db";
import { orchestratorFullAccess } from "@/lib/orchestrator/full-access";
import { sweepState } from "@/lib/worktree-sweep/state";

const body = z.union([
  z.object({
    // Null clears the setting: the global one, then the default, applies.
    days: sweepDays.nullable(),
    projectId: z.string().min(1).optional(),
  }),
  // `session`: the AgentOS session the `aos` command runs in, if any.
  z.object({ armed: z.boolean(), session: z.string().min(1).optional() }),
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
      // A session turns it on only as an orchestrator whose workspace has
      // Orchestrator full access on.
      if (got.data.session) {
        const s = db
          .prepare(`SELECT * FROM session_rows WHERE id = ?`)
          .get(got.data.session) as Session | undefined;
        if (!s || !orchestratorFullAccess(s))
          return NextResponse.json(
            {
              error:
                "a session can't turn the full clean-up on: Saad does (Health, Clean-up, Turn on), or the orchestrator's sweep_arm tool when he has said to",
            },
            { status: 403 }
          );
      }
    }
    setReaperArmed(got.data.armed);
    return NextResponse.json(sweepState());
  }
  const { days, projectId } = got.data;
  if (projectId) setProjectSweepDays(projectId, days);
  else setGlobalSweepDays(days);
  return NextResponse.json(sweepState());
}
