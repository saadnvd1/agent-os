import { NextRequest, NextResponse } from "next/server";
import {
  effectiveModels,
  savedModelSettings,
  setModelSettings,
} from "@/lib/models/config";
import { DEFAULT_ROLE_MODELS } from "@/lib/models/roles";
import { requireLocalTrust } from "@/lib/security/route-guard";

// GET /api/models - model routing: what's saved, what's in force, and the
// role defaults. Providers carry key references only, never a key.
export async function GET() {
  return NextResponse.json({
    saved: savedModelSettings(),
    effective: effectiveModels(),
    defaults: DEFAULT_ROLE_MODELS,
  });
}

// PUT /api/models {roles?, subagents?, providers?, prices?, planStep?} - replaces the
// saved settings. Only from this machine or the tailnet: a provider's base
// URL and key reference decide where a key is sent, so a stolen device
// token mustn't be able to point them anywhere.
export async function PUT(request: NextRequest) {
  const refused = requireLocalTrust(request);
  if (refused) return refused;
  try {
    setModelSettings(await request.json());
    return GET();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
