import { z } from "zod";
import { deleteGroup, updateGroup } from "@/lib/session-groups";
import { groupRoute, run } from "@/lib/session-groups/route";

type Ctx = { params: Promise<{ id: string }> };

const patch = z.object({
  name: z.string().optional(),
  collapsed: z.boolean().optional(),
});

// PATCH /api/session-groups/:id { name?, collapsed? } - rename or fold.
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  return groupRoute(request, patch, (b) => ({
    sessionGroup: updateGroup(id, b),
  }));
}

// DELETE /api/session-groups/:id - soft delete; its sessions fall back to the
// status shelves and restore brings them back.
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  return run(() => ({ sessionGroup: deleteGroup(id) }));
}
