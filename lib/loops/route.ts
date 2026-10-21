import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { refuse } from "../tasks/contract/authorize";
import { requireApprover } from "../security/approver";
import { db, type Session } from "../db";
import { LoopError } from "./types";

type Ctx = { params: Promise<{ id: string }> };

export const criterionSchema = z.object({
  text: z.string().max(2000),
  source: z.enum(["card", "brief", "plan", "user"]).optional(),
  evidenceKind: z
    .enum(["test", "diff", "typecheck", "ci"])
    .nullable()
    .optional(),
});

export const limitsSchema = z
  .object({
    maxCycles: z.number(),
    maxCostUsd: z.number(),
    maxMinutes: z.number(),
    graceSeconds: z.number(),
    stallCycles: z.number(),
    repeatCycles: z.number(),
  })
  .partial();

// A task's loop route: the same device rule as the task's other routes, a
// zod-checked body, and the loop's own errors as their status codes.
export async function loopRoute<B = undefined>(
  request: NextRequest,
  { params }: Ctx,
  opts: {
    schema?: z.ZodType<B>;
    // Raises what the loop may spend or skips a check: a device that can't
    // answer asks may not.
    approver?: (body: B) => boolean;
  },
  run: (
    task: Session,
    body: B,
    device: string | null
  ) => Promise<object> | object
): Promise<NextResponse> {
  const id = (await params).id;
  const refused = refuse(request, id, "open");
  if (refused) return refused;
  const task = db.prepare(`SELECT * FROM session_rows WHERE id = ?`).get(id) as
    Session | undefined;
  if (!task)
    return NextResponse.json({ error: "No such task" }, { status: 404 });
  let body = undefined as B;
  if (opts.schema) {
    const parsed = opts.schema.safeParse(
      await request.json().catch(() => ({}))
    );
    if (!parsed.success)
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Bad request" },
        { status: 400 }
      );
    body = parsed.data;
  }
  let device: string | null = null;
  if (opts.approver?.(body)) {
    const gate = requireApprover(request);
    if (!gate.ok) return gate.response;
    device = gate.approver.deviceId;
  }
  try {
    return NextResponse.json(await run(task, body, device));
  } catch (error) {
    if (error instanceof LoopError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
