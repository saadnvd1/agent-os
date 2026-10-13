/**
 * The routes only the device that moved a task here may call on it
 * (held.ts): message, stop, done and read. Each is refused for any other
 * device, and for a task that isn't held.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, type Session } from "../db";
import { callingDevice } from "../security/device-me";
import { holderRefusal } from "./held";

type Ctx = { params: Promise<{ id: string }> };

export async function heldRoute(
  request: NextRequest,
  { params }: Ctx,
  run: (task: Session) => Promise<object>
): Promise<NextResponse> {
  const id = (await params).id;
  const task = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
    | Session
    | undefined;
  if (!task?.held_by_device)
    return NextResponse.json({ error: "No such held task" }, { status: 404 });
  const refusal = holderRefusal(task, callingDevice(request));
  if (refusal) return NextResponse.json({ error: refusal }, { status: 403 });
  try {
    return NextResponse.json(await run(task));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
