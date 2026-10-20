import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApprover } from "@/lib/security/approver";
import { confirmLink } from "@/lib/peer/pairing-out";

const bodySchema = z.object({ code: z.string().max(32) });

// POST /api/peers/link/:id/confirm {code} - the code the other machine shows
// once it took ours, typed here: only then is it pinned. Same gate as
// starting the link.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "code required" }, { status: 400 });
  const result = confirmLink((await params).id, body.data.code);
  if (!result.ok)
    return NextResponse.json(
      { error: result.error, attemptsLeft: result.attemptsLeft },
      { status: result.status }
    );
  return NextResponse.json({ link: result.link });
}
