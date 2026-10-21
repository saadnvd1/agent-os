import { NextRequest, NextResponse } from "next/server";
import { refuse } from "@/lib/tasks/contract/authorize";
import { generateReport } from "@/lib/reports/generate";
import { readReport } from "@/lib/reports/read";
import { historyOf } from "@/lib/reports/store";
import { db } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

const exists = (id: string) =>
  !!db.prepare(`SELECT 1 FROM session_rows WHERE id = ?`).get(id);

// GET /api/tasks/:id/report - the latest plain-English health report, whether
// one is being built, and the task's operating mode. ?history=1 lists the
// earlier ones.
export async function GET(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const refused = refuse(request, id, "open");
  if (refused) return refused;
  if (!exists(id))
    return NextResponse.json({ error: "No such task" }, { status: 404 });
  if (request.nextUrl.searchParams.get("history") === "1")
    return NextResponse.json({ history: historyOf(id) });
  return NextResponse.json(readReport(id));
}

// POST /api/tasks/:id/report - build a new report now. Answers at once; the
// client polls the GET until `generating` clears.
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const refused = refuse(request, id, "plan");
  if (refused) return refused;
  if (!exists(id))
    return NextResponse.json({ error: "No such task" }, { status: 404 });
  generateReport(id, "on-demand").catch((error) =>
    console.error(`Report ${id}:`, error)
  );
  return NextResponse.json({ generating: true }, { status: 202 });
}
