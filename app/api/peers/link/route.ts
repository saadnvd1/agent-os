import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApprover } from "@/lib/security/approver";
import { LinkError, startLink } from "@/lib/peer/pairing-out";

const bodySchema = z.object({ machineId: z.string().min(1).max(64) });

// POST /api/peers/link {machineId} - ask an account machine to link. Once
// linked it can run code here too, so only a trusted place may start it.
export async function POST(request: NextRequest) {
  const gate = requireApprover(request);
  if (!gate.ok) return gate.response;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "machineId required" }, { status: 400 });
  try {
    return NextResponse.json({ link: await startLink(body.data.machineId) });
  } catch (error) {
    const status = error instanceof LinkError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status });
  }
}
