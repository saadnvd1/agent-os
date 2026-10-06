import { NextResponse } from "next/server";
import { unarchiveSession } from "@/lib/done/archive";

// POST /api/sessions/:id/unarchive - back into the sidebar.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = unarchiveSession((await params).id);
    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
