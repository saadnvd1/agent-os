import { NextResponse } from "next/server";
import { archiveChecked } from "@/lib/done/archive";

// POST /api/sessions/:id/archive - put a session away, out of the sidebar.
// 409 with the reason when refused.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await archiveChecked((await params).id);
    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
