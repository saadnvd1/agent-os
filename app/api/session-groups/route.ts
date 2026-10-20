import { z } from "zod";
import { createGroup, listGroups } from "@/lib/session-groups";
import { groupRoute, run } from "@/lib/session-groups/route";

const create = z.object({
  name: z.string({ error: "A group needs a name" }),
  workspaceId: z.string().nullable(),
});

// GET /api/session-groups - every live group.
export async function GET() {
  return run(() => ({ sessionGroups: listGroups() }));
}

// POST /api/session-groups { name, workspaceId } - create one at the bottom
// of its workspace's order.
export async function POST(request: Request) {
  return groupRoute(request, create, (b) => ({
    sessionGroup: createGroup(b.workspaceId, b.name),
  }));
}
