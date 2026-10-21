import { z } from "zod";
import { dismissRecommendation } from "@/lib/analyst";
import { analystRoute } from "@/lib/analyst/route";

type Ctx = { params: Promise<{ id: string; recId: string }> };

// POST /api/analyst/:id/recommendations/:recId/dismiss - 409 once decided.
export async function POST(request: Request, { params }: Ctx) {
  const { id, recId } = await params;
  return analystRoute(request, z.object({}), () => ({
    recommendation: dismissRecommendation(id, recId),
  }));
}
