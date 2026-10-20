import { z } from "zod";
import { reorderGroups } from "@/lib/session-groups";
import { groupRoute } from "@/lib/session-groups/route";

const order = z.object({
  workspaceId: z.string().nullable(),
  ids: z.array(z.string()),
});

// POST /api/session-groups/order { workspaceId, ids } - a workspace's order.
export async function POST(request: Request) {
  return groupRoute(request, order, (b) => ({
    sessionGroups: reorderGroups(b.workspaceId, b.ids),
  }));
}
