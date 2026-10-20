import { restoreGroup } from "@/lib/session-groups";
import { run } from "@/lib/session-groups/route";

// POST /api/session-groups/:id/restore - undo a delete.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return run(() => ({ sessionGroup: restoreGroup(id) }));
}
