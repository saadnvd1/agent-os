import { NextRequest, NextResponse } from "next/server";
import { refuse } from "@/lib/tasks/contract/authorize";
import { approveDraft, dismissDraft, DraftError } from "@/lib/reports/drafts";
import { AnalystError } from "@/lib/analyst/types";
import { readReport } from "@/lib/reports/read";

// POST /api/tasks/:id/report/draft {source, id, linkId?, action, text?} -
// send the drafted next prompt to the coding agent (text: the reader's
// edit), or dismiss it. 409 when it was already decided.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: taskId } = await params;
  const refused = refuse(request, taskId, "plan");
  if (refused) return refused;
  const b = await request.json().catch(() => ({}));
  const source =
    b.source === "analyst"
      ? "analyst"
      : b.source === "report"
        ? "report"
        : null;
  if (
    !source ||
    typeof b.id !== "string" ||
    !["send", "dismiss"].includes(b.action)
  )
    return NextResponse.json({ error: "Bad draft request" }, { status: 400 });
  if (
    b.text !== undefined &&
    (typeof b.text !== "string" || b.text.length > 20_000)
  )
    return NextResponse.json({ error: "Bad text" }, { status: 400 });
  const ref = {
    source,
    id: b.id,
    linkId: typeof b.linkId === "string" ? b.linkId : undefined,
  } as const;
  try {
    if (b.action === "send")
      await approveDraft(taskId, { ...ref, text: b.text });
    else dismissDraft(taskId, ref);
    return NextResponse.json(readReport(taskId));
  } catch (error) {
    if (error instanceof DraftError || error instanceof AnalystError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
