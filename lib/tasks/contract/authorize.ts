/**
 * Who may call a task route on the machine that runs the task. One rule per
 * route, applied the same way everywhere:
 *
 *  - holder: a task an orchestrator on another machine holds (held.ts); only
 *    the device that holds it, and a task nobody holds is "No such held task".
 *  - open: the holder, when there is one; any caller otherwise. A mirror row
 *    or a task started here is never held, so this machine's own web UI
 *    (which sends no device) is never refused on them.
 *  - plan: open, and a plan another machine placed here is read and approved
 *    by that machine only.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, type Session } from "../../db";
import { callingDevice } from "../../security/device-me";
import { heldRefusal, holderRefusal, planWaitRefusal } from "../held";

export type Rule = "holder" | "open" | "plan";

type Ctx = { params: Promise<{ id: string }> };

export interface Refusal {
  status: 403 | 404;
  error: string;
}

export function callerRefusal(
  id: string,
  device: string | null | undefined,
  rule: Rule
): Refusal | null {
  if (rule === "holder") {
    const task = db
      .prepare(
        `SELECT held_by_device, held_from FROM session_rows WHERE id = ?`
      )
      .get(id) as Pick<Session, "held_by_device" | "held_from"> | undefined;
    if (!task?.held_by_device)
      return { status: 404, error: "No such held task" };
    const error = holderRefusal(task, device);
    return error ? { status: 403, error } : null;
  }
  const error =
    heldRefusal(id, device) ??
    (rule === "plan" ? planWaitRefusal(id, device) : null);
  return error ? { status: 403, error } : null;
}

/** The refusal as a response, or null when the caller may go on. */
export function refuse(
  request: NextRequest,
  id: string,
  rule: Rule
): NextResponse | null {
  const refusal = callerRefusal(id, callingDevice(request), rule);
  return refusal
    ? NextResponse.json({ error: refusal.error }, { status: refusal.status })
    : null;
}

export async function taskRoute(
  request: NextRequest,
  { params }: Ctx,
  rule: Rule,
  run: (task: Session) => Promise<object>
): Promise<NextResponse> {
  const id = (await params).id;
  const refused = refuse(request, id, rule);
  if (refused) return refused;
  const task = db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    | Session
    | undefined;
  if (!task)
    return NextResponse.json({ error: "No such task" }, { status: 404 });
  try {
    return NextResponse.json(await run(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
