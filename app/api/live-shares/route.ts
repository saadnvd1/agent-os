import { NextResponse } from "next/server";
import { z } from "zod";
import { linked, NOT_LINKED } from "@/lib/share/connect";
import { fail, readJson, refuseDemo, toResponse } from "@/lib/share/route";
import { createLive, inviteFor, listLive, startLive } from "@/lib/live/service";

const Create = z.object({
  sessionId: z.string().min(1).max(100),
  expiresIn: z.enum(["1h", "session"]).default("1h"),
  level: z.enum(["watch", "suggest", "drive"]).default("suggest"),
  history: z.boolean().default(true),
  // Absent or null: no code. {} generates one; { custom } uses the host's.
  code: z
    .object({ custom: z.string().max(40).optional() })
    .nullable()
    .optional(),
});

// POST /api/live-shares - mint a live link for one chat and start publishing.
export async function POST(request: Request) {
  const refused = refuseDemo();
  if (refused) return refused;
  const read = await readJson(request);
  if ("refused" in read) return read.refused;
  const body = Create.safeParse(read.body);
  if (!body.success) return fail("sessionId is required.", 400);
  if (!linked()) return fail(NOT_LINKED, 409);
  try {
    const view = await createLive(
      body.data.sessionId,
      body.data.expiresIn,
      body.data.level,
      body.data.history,
      body.data.code
    );
    return NextResponse.json(view, { status: 201 });
  } catch (err) {
    if ((err as Error).message === "Session not found")
      return fail("Session not found.", 404);
    return toResponse(err);
  }
}

// GET /api/live-shares?sessionId= - live links this machine holds, with who
// is waiting, who is watching and the open suggestions.
export async function GET(request: Request) {
  const refused = refuseDemo();
  if (refused) return refused;
  startLive();
  const sessionId =
    new URL(request.url).searchParams.get("sessionId") ?? undefined;
  return NextResponse.json({
    linked: linked(),
    shares: listLive(sessionId),
    ...(sessionId ? { invite: inviteFor(sessionId) } : {}),
  });
}
