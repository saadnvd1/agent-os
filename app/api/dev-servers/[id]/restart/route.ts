import { NextRequest, NextResponse } from "next/server";
import { restartServer } from "@/lib/dev-servers";

// POST /api/dev-servers/[id]/restart - Restart a server
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const server = await restartServer(id);
    return NextResponse.json({ server });
  } catch (error) {
    console.error("Error restarting dev server:", error);
    return NextResponse.json(
      { error: "Failed to restart dev server" },
      { status: 500 }
    );
  }
}
