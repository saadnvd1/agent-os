import { createLink, createLinkSchema, linkView } from "@/lib/analyst";
import { analystRoute } from "@/lib/analyst/route";

// POST /api/analyst { coderSessionId | newCoder, analystModel?, reviewLast? }
// - pairs an analyst chat with a coding chat (a new one with newCoder).
export async function POST(request: Request) {
  return analystRoute(request, createLinkSchema, async (b) => ({
    link: linkView((await createLink(b)).id),
  }));
}
