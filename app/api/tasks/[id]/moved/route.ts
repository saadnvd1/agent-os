import { NextRequest, NextResponse } from "next/server";
import { markMoved } from "@/lib/tasks/move";

// POST /api/tasks/:id/moved - the task now runs on the machine named `to`
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { to } = await request.json().catch(() => ({}));
  markMoved((await params).id, String(to || "another machine").slice(0, 100));
  return NextResponse.json({ success: true });
}
