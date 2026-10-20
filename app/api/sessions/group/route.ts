import { z } from "zod";
import { assignSessions } from "@/lib/session-groups";
import { groupRoute } from "@/lib/session-groups/route";

const body = z.object({
  ids: z.array(z.string()).min(1).max(200),
  groupId: z.string().nullable(),
});

// POST /api/sessions/group { ids, groupId | null } - the multi-select move.
// All or none: one session of another workspace refuses the lot.
export async function POST(request: Request) {
  return groupRoute(request, body, (b) => ({
    ok: true,
    ...assignSessions(b.ids, b.groupId),
  }));
}
