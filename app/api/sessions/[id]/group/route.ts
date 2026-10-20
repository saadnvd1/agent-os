import { z } from "zod";
import { assignSessions } from "@/lib/session-groups";
import { groupRoute } from "@/lib/session-groups/route";

const body = z.object({ groupId: z.string().nullable() });

// POST /api/sessions/:id/group { groupId | null } - join a group of the
// session's workspace, or leave.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return groupRoute(request, body, (b) => ({
    ok: true,
    ...assignSessions([id], b.groupId),
  }));
}
