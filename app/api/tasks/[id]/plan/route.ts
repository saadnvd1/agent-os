import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { db, type Session } from "@/lib/db";
import { callingDevice } from "@/lib/security/device-me";
import { heldRefusal, planWaitRefusal } from "@/lib/tasks/held";
import { MAX_PLAN_BYTES } from "@/lib/tasks/move-bundle";
import { PLAN_FILE } from "@/lib/models/plan-step";
import { expandHome } from "@/lib/tasks/session";

// GET /api/tasks/:id/plan - the plan file of a task whose plan is written, for
// the machine that placed the plan here and decides what follows it.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const device = callingDevice(request);
  const refusal = heldRefusal(id, device) ?? planWaitRefusal(id, device);
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  const s = db
    .prepare(`SELECT plan_phase, worktree_path FROM sessions WHERE id = ?`)
    .get(id) as Pick<Session, "plan_phase" | "worktree_path"> | undefined;
  if (!s?.worktree_path)
    return NextResponse.json({ error: "No such task" }, { status: 404 });
  let text: string | null = null;
  try {
    const read = await fs.readFile(
      path.join(expandHome(s.worktree_path), PLAN_FILE),
      "utf8"
    );
    text = read.length > MAX_PLAN_BYTES ? read.slice(0, MAX_PLAN_BYTES) : read;
  } catch {
    // No plan file was written.
  }
  return NextResponse.json({ text, phase: s.plan_phase ?? null });
}
