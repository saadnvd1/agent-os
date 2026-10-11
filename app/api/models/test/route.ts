import { NextRequest, NextResponse } from "next/server";
import { testProvider } from "@/lib/models/test-provider";
import { requireLocalTrust } from "@/lib/security/route-guard";

// POST /api/models/test {provider, model?} - one tiny request to the
// provider with its key; says whether it answered, never the key. It sends
// a key, so only from this machine or the tailnet.
export async function POST(request: NextRequest) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  const { provider, model } = await request.json().catch(() => ({}));
  if (typeof provider !== "string" || !provider)
    return NextResponse.json({ error: "Name a provider" }, { status: 400 });
  return NextResponse.json(
    await testProvider(provider, typeof model === "string" ? model : undefined)
  );
}
