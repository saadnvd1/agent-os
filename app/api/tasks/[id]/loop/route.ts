import { NextRequest } from "next/server";
import { z } from "zod";
import { editLoop, loopView, startLoop } from "@/lib/loops";
import { criterionSchema, limitsSchema, loopRoute } from "@/lib/loops/route";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/tasks/:id/loop - the loop, its checklist and its newest cycles;
// ?before=<n> pages back.
export async function GET(request: NextRequest, ctx: Ctx) {
  const before = Number(request.nextUrl.searchParams.get("before"));
  return loopRoute(request, ctx, {}, (task) => ({
    view: loopView(task.id, undefined, {
      before: Number.isFinite(before) && before > 0 ? before : undefined,
    }),
  }));
}

const startSchema = z.object({
  criteria: z.array(criterionSchema).max(60),
  limits: limitsSchema.optional(),
});

// POST /api/tasks/:id/loop - start a loop with its criteria and limits.
export async function POST(request: NextRequest, ctx: Ctx) {
  return loopRoute(
    request,
    ctx,
    { schema: startSchema },
    async (task, body) => ({
      view: await startLoop(task.id, body),
    })
  );
}

const editSchema = z.object({
  limits: limitsSchema.optional(),
  extend: z
    .object({
      cycles: z.number().optional(),
      costUsd: z.number().optional(),
      minutes: z.number().optional(),
    })
    .optional(),
  addCriteria: z.array(criterionSchema).optional(),
  editCriteria: z
    .array(z.object({ id: z.number(), text: z.string() }))
    .optional(),
  removeCriteria: z.array(z.number()).optional(),
  waive: z.array(z.number()).optional(),
});

// PATCH /api/tasks/:id/loop - limits, an extension, or the checklist.
// Raising the spend and waiving a criterion need "Can approve".
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return loopRoute(
    request,
    ctx,
    {
      schema: editSchema,
      approver: (b) =>
        !!(
          b.extend ||
          b.waive?.length ||
          (b.limits && b.limits.maxCostUsd !== undefined)
        ),
    },
    (task, body, device) => ({
      view: editLoop(task.id, body, device ? "a device" : "you"),
    })
  );
}
