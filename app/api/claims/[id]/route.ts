import { NextResponse } from "next/server";
import { endOutside } from "@/lib/claims";

export const dynamic = "force-dynamic";

// DELETE /api/claims/:id - an outside session ends its own claim. A task's
// or another machine's claim can't be ended this way.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const result = endOutside(id);
  if (result === "forbidden")
    return NextResponse.json(
      { error: "Only an outside session's claim can be ended here" },
      { status: 403 }
    );
  return NextResponse.json({ ok: true, ended: result === "ended" });
}
