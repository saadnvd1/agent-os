import { refuse } from "@/lib/tasks/contract/authorize";
import { NextRequest, NextResponse } from "next/server";
import { approvePlanNow } from "@/lib/models/plan-step";

// Approves a plan-only task's plan: it continues on the implementation
// model. An optional message amends the plan (recorded as a scope change).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const refused = refuse(request, id, "plan");
  if (refused) return refused;
  try {
    const body = await request.json().catch(() => ({}));
    const message =
      typeof body?.message === "string" && body.message.trim()
        ? body.message.trim().slice(0, 8000)
        : undefined;
    const out = await approvePlanNow(id, message);
    return NextResponse.json({ success: true, model: out.ref });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
