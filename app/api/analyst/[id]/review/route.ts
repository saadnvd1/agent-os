import { z } from "zod";
import { AnalystError, getLinkOrThrow, pushDigest } from "@/lib/analyst";
import { analystRoute } from "@/lib/analyst/route";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/analyst/:id/review - Review now: the turns since the last
// review, or the last turn again.
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  return analystRoute(request, z.object({}), async () => {
    const link = getLinkOrThrow(id);
    if (link.endedAt) throw new AnalystError("This pairing has ended", 409);
    const result = await pushDigest(id, { force: true });
    if (result === "nothing")
      throw new AnalystError(
        "The coding agent hasn't finished a turn yet",
        409
      );
    return { result };
  });
}
