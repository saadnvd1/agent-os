import { NextRequest, NextResponse } from "next/server";
import { linkHost } from "@/lib/hosts/link";
import { requireLocalTrust } from "@/lib/security/route-guard";

// POST /api/hosts/:id/link {url?} - pair with that machine's own AgentOS.
// It mints a device there, so like /api/pair/start: this machine or the tailnet.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  try {
    const { url } = await request.json().catch(() => ({}));
    const linked = await linkHost(
      (await params).id,
      typeof url === "string" && url.trim() ? url : undefined
    );
    return NextResponse.json(linked);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
