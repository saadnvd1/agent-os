import { NextRequest, NextResponse } from "next/server";
import { stopServer } from "@/lib/dev-servers";

// POST /api/dev-servers/[id]/stop - Stop a server
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await stopServer(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error stopping dev server:", error);
    return NextResponse.json(
      { error: "Failed to stop dev server" },
      { status: 500 }
    );
  }
}
