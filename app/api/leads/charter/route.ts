import { NextRequest, NextResponse } from "next/server";
import { requireApprover } from "@/lib/security/approver";
import { getCharter } from "@/lib/leads/charters";
import {
  charterEditSchema,
  charterView,
  deliverCharter,
  editCharter,
} from "@/lib/leads/edit-charter";

const notFound = () =>
  NextResponse.json({ error: "No charter for that lead" }, { status: 404 });

// One lead's charter, for the editor.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const c = getCharter(q.get("workspaceId") ?? "", q.get("kind") ?? "");
  return c ? NextResponse.json({ charter: charterView(c) }) : notFound();
}

// Replaces a lead's charter. A running lead is told at once; any other reads
// it in its brief at its next start.
export async function PUT(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const parsed = charterEditSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid charter" },
      { status: 400 }
    );
  const charter = editCharter(parsed.data);
  if (!charter) return notFound();
  const delivered = await deliverCharter(charter).catch(() => false);
  return NextResponse.json({ charter, delivered });
}
