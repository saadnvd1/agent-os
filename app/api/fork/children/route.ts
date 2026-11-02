import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/fork/api";
import { db } from "@/lib/db";
import { allChildren, childrenOf, getChild, numberOf } from "@/lib/fork/ledger";
import { childrenView, statsOf, statsText } from "@/lib/fork/view";
import { forksOn } from "@/lib/fork/options";

// A session's forks, for `aos children` and the chat's strip. `stats` adds
// the numbers; with no session, the totals over every fork.
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const session = params.get("session");
    if (!session && params.get("stats") !== "1")
      throw new Error("Which session?");
    if (!session) {
      const { db } = await import("@/lib/db");
      const rows = db
        .prepare(`SELECT * FROM session_children`)
        .all() as Parameters<typeof statsOf>[0];
      const stats = statsOf(rows);
      return NextResponse.json({ stats, text: statsText(stats) });
    }
    const view = childrenView(session);
    const own = getChild(session);
    const asChild = own
      ? {
          parentId: own.parent_session_id,
          parentName:
            (
              db
                .prepare(`SELECT name FROM sessions WHERE id = ?`)
                .get(own.parent_session_id) as { name: string } | undefined
            )?.name ?? "its session",
          n: numberOf(own.parent_session_id, session),
          label: own.label,
          state: own.state,
          worktree: !!own.worktree,
        }
      : null;
    const rows = childrenOf(session);
    const stats = params.get("stats") === "1" ? statsOf(rows) : undefined;
    return NextResponse.json({
      enabled: forksOn(),
      asChild,
      ...view,
      ...(stats && { stats, text: statsText(stats) }),
    });
  } catch (error) {
    return fail(error);
  }
}
