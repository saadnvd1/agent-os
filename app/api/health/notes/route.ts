import { NextRequest, NextResponse } from "next/server";
import { addNote, deleteNote, listNotes, SEED_NOTES } from "@/lib/health/notes";
import { AREAS, type Area } from "@/lib/health/types";

// GET /api/health/notes - what normal looks like, per area: the built-in
// lines and the ones learned or typed here.
export function GET() {
  return NextResponse.json({ seeds: SEED_NOTES, notes: listNotes() });
}

// POST { area, line } adds a line as Saad's own.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    area?: unknown;
    line?: unknown;
  } | null;
  if (
    !body ||
    typeof body.line !== "string" ||
    !AREAS.includes(body.area as Area)
  )
    return NextResponse.json({ error: "Send { area, line }" }, { status: 400 });
  const id = addNote(body.area as Area, body.line, "saad");
  return NextResponse.json({ id });
}

// DELETE ?id= removes a learned or typed line.
export function DELETE(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "Send ?id=" }, { status: 400 });
  return NextResponse.json({ ok: deleteNote(id) });
}
