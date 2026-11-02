import { NextResponse } from "next/server";
import { archiveChecked, ForkChildrenOpen } from "@/lib/done/archive";

// POST /api/sessions/:id/archive - put a session away, out of the sidebar.
// 409 with the reason when refused.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      children?: unknown;
    };
    const children =
      body.children === "stop" || body.children === "keep"
        ? body.children
        : undefined;
    const session = await archiveChecked((await params).id, { children });
    return NextResponse.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: message,
        ...(error instanceof ForkChildrenOpen && { children: error.open }),
      },
      { status: 409 }
    );
  }
}
