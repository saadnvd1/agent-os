import { NextRequest, NextResponse } from "next/server";
import { deleteHost } from "@/lib/hosts";
import { pinForHost } from "@/lib/peer/links";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    // Removing it here would leave the other machine linked to this one.
    if (pinForHost(id))
      return NextResponse.json(
        { error: "It's linked through Connect: unlink it first." },
        { status: 409 }
      );
    deleteHost(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
