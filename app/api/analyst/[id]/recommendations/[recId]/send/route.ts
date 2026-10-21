import { sendRecommendation, sendSchema } from "@/lib/analyst";
import { analystRoute } from "@/lib/analyst/route";

type Ctx = { params: Promise<{ id: string; recId: string }> };

// POST /api/analyst/:id/recommendations/:recId/send { text? } - Send to
// Coding Agent, edited when text is given. 409 once decided.
export async function POST(request: Request, { params }: Ctx) {
  const { id, recId } = await params;
  return analystRoute(request, sendSchema, async (b) => ({
    recommendation: await sendRecommendation(id, recId, b.text),
  }));
}
