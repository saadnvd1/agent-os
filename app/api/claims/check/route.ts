import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkStart } from "@/lib/claims/startCheck";
import { startWarning } from "@/lib/claims/startWarning";

export const dynamic = "force-dynamic";

const body = z.object({
  projectId: z.string().min(1).max(100),
  name: z.string().max(200).optional(),
  prompt: z.string().max(100_000),
  branch: z.string().max(250).nullable().optional(),
});

// POST /api/claims/check - before a person starts a task: who else is on the
// same work. Reads claims and the repo's file list; never blocks a start.
export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Bad check" }, { status: 400 });
  const { overlaps } = await checkStart(parsed.data);
  return NextResponse.json({ overlaps: overlaps.map(startWarning) });
}
