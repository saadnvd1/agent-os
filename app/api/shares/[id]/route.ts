import { NextResponse } from "next/server";
import { NOT_LINKED, linked, revokeRemote } from "@/lib/share/connect";
import { fail, refuseDemo, toResponse } from "@/lib/share/route";
import { getSharedLink, markRevoked } from "@/lib/share/store";

// DELETE /api/shares/[id] - revoke a link: Connect deletes the page at once.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const refused = refuseDemo();
  if (refused) return refused;
  const { id } = await params;
  if (!getSharedLink(id)) return fail("No such shared link.", 404);
  if (!linked()) return fail(NOT_LINKED, 409);
  try {
    await revokeRemote(id);
    markRevoked(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
