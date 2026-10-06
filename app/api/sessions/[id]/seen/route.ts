import { NextResponse } from "next/server";
import { markSeen } from "@/lib/needs-you";

// POST /api/sessions/:id/seen - the reader is looking at this session now.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  markSeen(id);
  return NextResponse.json({ ok: true });
}
