import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getNote,
  MAX_NOTE_BYTES,
  NoteError,
  saveNote,
  sessionExists,
} from "@/lib/notes";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({
  doc: z.looseObject({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  }),
});

// GET /api/sessions/:id/notes - the session's scratch note (doc null: none yet).
export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!sessionExists(id))
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json(getNote(id));
}

// PUT /api/sessions/:id/notes { doc } - replace it with a Tiptap document.
export async function PUT(request: Request, { params }: Ctx) {
  const { id } = await params;
  const raw = await request.text();
  // Refused before parsing: the stored JSON is never bigger than the body.
  if (Buffer.byteLength(raw) > MAX_NOTE_BYTES + 1024)
    return NextResponse.json({ error: "Note is too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = body.safeParse(json);
  if (!parsed.success)
    return NextResponse.json(
      { error: "doc must be a Tiptap document" },
      { status: 400 }
    );
  try {
    return NextResponse.json(saveNote(id, parsed.data.doc));
  } catch (err) {
    if (err instanceof NoteError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
