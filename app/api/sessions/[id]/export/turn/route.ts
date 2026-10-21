import { NextResponse } from "next/server";
import { z } from "zod";
import { loadSession } from "@/lib/export/load";
import { copyTurn } from "@/lib/export/turn";
import { shareContext } from "@/lib/share/context";
import { readJson, refuseDemo, toResponse } from "@/lib/share/route";
import { BadShare } from "@/lib/share/service";

const Body = z.object({ startId: z.string().min(1).max(200) });

// POST /api/sessions/:id/export/turn - one turn as Markdown for the clipboard,
// secrets masked: the whole turn, and its last agent message.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const refused = refuseDemo();
  if (refused) return refused;
  const read = await readJson(request);
  if ("refused" in read) return read.refused;
  try {
    const { id } = await params;
    const body = Body.safeParse(read.body);
    if (!body.success) throw new BadShare("startId is required", 400);
    const loaded = loadSession(id);
    return NextResponse.json(
      copyTurn(loaded.items, body.data.startId, shareContext(), loaded.meta),
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return toResponse(err);
  }
}
