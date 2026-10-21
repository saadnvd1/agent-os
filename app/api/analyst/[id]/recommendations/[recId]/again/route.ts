import { z } from "zod";
import { askAgain } from "@/lib/analyst";
import { analystRoute } from "@/lib/analyst/route";

type Ctx = { params: Promise<{ id: string; recId: string }> };

// POST /api/analyst/:id/recommendations/:recId/again - Ask again, for a
// reply that carried no valid recommendation.
export async function POST(request: Request, { params }: Ctx) {
  const { id, recId } = await params;
  return analystRoute(request, z.object({}), async () => {
    await askAgain(id, recId);
    return { ok: true };
  });
}
