import { NextRequest, NextResponse } from "next/server";
import { db, type Session } from "@/lib/db";
import { notifyStatusChanged } from "@/lib/status/hub";

// Saad's edits to a waiting plan's pieces: which to fold into the one before
// and which to leave out. Kept on the task and applied when the plan is
// approved; piece 1 can't be edited.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const ints = (v: unknown) =>
    Array.isArray(v)
      ? [...new Set(v.filter((n) => Number.isInteger(n) && n >= 2 && n <= 6))]
      : [];
  const merge = ints(body?.merge);
  const drop = ints(body?.drop).filter((n) => !merge.includes(n));
  const session = db
    .prepare(`SELECT plan_phase FROM sessions WHERE id = ?`)
    .get(id) as Pick<Session, "plan_phase"> | undefined;
  if (session?.plan_phase !== "awaiting")
    return NextResponse.json(
      { error: "That task isn't waiting for plan approval" },
      { status: 409 }
    );
  db.prepare(`UPDATE sessions SET plan_edits = ? WHERE id = ?`).run(
    JSON.stringify({ merge, drop }),
    id
  );
  notifyStatusChanged();
  return NextResponse.json({ success: true, merge, drop });
}
