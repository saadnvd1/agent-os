import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sweepNow } from "@/lib/worktree-sweep/start";

const body = z.object({ dryRun: z.boolean().optional() });

// Starts a run and answers at once; its result is in the run list.
export async function POST(request: NextRequest) {
  const got = body.safeParse(await request.json().catch(() => ({})));
  if (!got.success)
    return NextResponse.json(
      { error: "dryRun must be a boolean" },
      { status: 400 }
    );
  try {
    const started = new Promise<void>((resolve, reject) => {
      sweepNow(got.data.dryRun).then(() => resolve(), reject);
      setTimeout(resolve, 250);
    });
    await started;
    return NextResponse.json({ started: true }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
