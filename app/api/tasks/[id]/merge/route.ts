import { refuse } from "@/lib/tasks/contract/authorize";
import { NextRequest, NextResponse } from "next/server";
import { signOffTask } from "@/lib/tasks";
import { callingDevice } from "@/lib/security/device-me";
import { isBranchName } from "@/lib/git";

// head: merge only if the PR is still at this commit; the answer names the
// commit it was pinned to, so another machine forwarding a merge can check.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = (await params).id;
  const refused = refuse(request, id, "open");
  if (refused) return refused;
  const { head, base } = await request.json().catch(() => ({}));
  if (
    head !== undefined &&
    !(typeof head === "string" && /^[0-9a-f]{40}$/.test(head))
  )
    return NextResponse.json({ error: "Bad head commit" }, { status: 400 });
  if (base !== undefined && !(typeof base === "string" && isBranchName(base)))
    return NextResponse.json({ error: "Bad base branch" }, { status: 400 });
  try {
    const method = await signOffTask(id, {
      head,
      base,
      device: callingDevice(request),
    });
    return NextResponse.json({ success: true, head: head ?? null, method });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
