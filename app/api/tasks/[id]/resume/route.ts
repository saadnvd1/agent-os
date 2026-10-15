import { refuse } from "@/lib/tasks/contract/authorize";
import { NextRequest, NextResponse } from "next/server";
import { resumeHere } from "@/lib/tasks/move-recover";

// POST /api/tasks/:id/resume {force?} - start its agent again here, on its
// conversation. A task left moving asks its target first unless forced.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const refused = refuse(request, id, "open");
  if (refused) return refused;
  const { force } = await request.json().catch(() => ({}));
  try {
    const result = await resumeHere(id, force === true);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
