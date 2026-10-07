import { NextRequest, NextResponse } from "next/server";
import { signOffTask } from "@/lib/tasks";

// head: merge only if the PR is still at this commit; the answer names the
// commit it was pinned to, so another machine forwarding a merge can check.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { head } = await request.json().catch(() => ({}));
  if (
    head !== undefined &&
    !(typeof head === "string" && /^[0-9a-f]{40}$/.test(head))
  )
    return NextResponse.json({ error: "Bad head commit" }, { status: 400 });
  try {
    await signOffTask((await params).id, { head });
    return NextResponse.json({ success: true, head: head ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
