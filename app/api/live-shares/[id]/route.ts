import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, readJson, refuseDemo, toResponse } from "@/lib/share/route";
import {
  admit,
  changeLevel,
  deny,
  dismissSuggestion,
  endLive,
  kick,
  sendSuggestion,
  startLive,
} from "@/lib/live/service";

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("admit"), guestId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("deny"), guestId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("kick"), guestId: z.string().min(1).max(64) }),
  z.object({ action: z.literal("level"), level: z.enum(["watch", "suggest"]) }),
  z.object({
    action: z.literal("send"),
    suggestionId: z.string().min(1).max(64),
    text: z.string().max(8000).optional(),
  }),
  z.object({
    action: z.literal("dismiss"),
    suggestionId: z.string().min(1).max(64),
  }),
]);

// POST /api/live-shares/:id - the host's decisions: let a guest in, turn one
// away, remove one, send a suggestion to the agent or dismiss it.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const refused = refuseDemo();
  if (refused) return refused;
  const { id } = await params;
  const read = await readJson(request);
  if ("refused" in read) return read.refused;
  const body = Action.safeParse(read.body);
  if (!body.success) return fail("Unknown action.", 400);
  startLive();
  try {
    const a = body.data;
    if (a.action === "admit") admit(id, a.guestId);
    else if (a.action === "deny") deny(id, a.guestId);
    else if (a.action === "kick") kick(id, a.guestId);
    else if (a.action === "level") changeLevel(id, a.level);
    else if (a.action === "send")
      await sendSuggestion(id, a.suggestionId, a.text);
    else dismissSuggestion(id, a.suggestionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}

// DELETE /api/live-shares/:id - end access for every guest.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const refused = refuseDemo();
  if (refused) return refused;
  const { id } = await params;
  startLive();
  try {
    await endLive(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
