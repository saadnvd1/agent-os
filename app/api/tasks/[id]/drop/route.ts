import { NextRequest, NextResponse } from "next/server";
import { refuse } from "@/lib/tasks/contract/authorize";
import { dropTask } from "@/lib/tasks";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const refused = refuse(request, id, "open");
  if (refused) return refused;
  try {
    await dropTask(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
