import { z } from "zod";
import {
  AnalystError,
  endLink,
  linkView,
  patchLinkSchema,
  setPaused,
} from "@/lib/analyst";
import { analystRoute, run } from "@/lib/analyst/route";

type Ctx = { params: Promise<{ id: string }> };

const view = (id: string) => {
  const link = linkView(id);
  if (!link) throw new AnalystError("Pairing not found", 404);
  return { link };
};

// GET /api/analyst/:id - the pairing, both sessions and its latest cards.
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  return run(() => view(id));
}

// PATCH /api/analyst/:id { paused } - stop or resume sending turns.
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  return analystRoute(request, patchLinkSchema, (b) => {
    setPaused(id, b.paused);
    return view(id);
  });
}

const unlink = z.object({ endAnalyst: z.boolean().optional() });

// DELETE /api/analyst/:id { endAnalyst? } - unlink; the analyst is settled
// unless endAnalyst is false. History is kept.
export async function DELETE(request: Request, { params }: Ctx) {
  const { id } = await params;
  return analystRoute(request, unlink, (b) => {
    endLink(id, b);
    return view(id);
  });
}
