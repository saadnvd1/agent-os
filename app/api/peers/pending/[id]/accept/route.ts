import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApprover } from "@/lib/security/approver";
import { acceptRequest } from "@/lib/peer/pairing";

const bodySchema = z.object({ code: z.string().max(32) });

// POST /api/peers/pending/:id/accept {code} - the code the other machine
// shows, typed here. Linking lets that machine run code here, so it takes
// this machine, the tailnet or a device with Can approve.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "code required" }, { status: 400 });
  const result = await acceptRequest((await params).id, body.data.code);
  if (!result.ok)
    return NextResponse.json(
      { error: result.error, attemptsLeft: result.attemptsLeft },
      { status: result.status }
    );
  return NextResponse.json({ hostId: result.hostId, name: result.name });
}
