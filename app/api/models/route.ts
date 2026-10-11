import { NextRequest, NextResponse } from "next/server";
import {
  effectiveModels,
  savedModelSettings,
  setModelSettings,
} from "@/lib/models/config";
import { DEFAULT_ROLE_MODELS } from "@/lib/models/roles";

// GET /api/models - model routing: what's saved, what's in force, and the
// role defaults. Providers carry key references only, never a key.
export async function GET() {
  return NextResponse.json({
    saved: savedModelSettings(),
    effective: effectiveModels(),
    defaults: DEFAULT_ROLE_MODELS,
  });
}

// PUT /api/models {roles?, providers?, prices?, planStep?} - replaces the
// saved settings.
export async function PUT(request: NextRequest) {
  try {
    setModelSettings(await request.json());
    return GET();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
