import { NextRequest, NextResponse } from "next/server";
import {
  HEALTH_DEFAULTS,
  HEALTH_LABELS,
  healthConfig,
  setHealthConfig,
} from "@/lib/health/config";

const body = () => ({
  config: healthConfig(),
  defaults: HEALTH_DEFAULTS,
  labels: HEALTH_LABELS,
});

// GET /api/health/config - the thresholds, their defaults and labels.
export function GET() {
  return NextResponse.json(body());
}

// PUT { patch: { name: number | null } } - null puts the default back.
export async function PUT(request: NextRequest) {
  const input = (await request.json().catch(() => null)) as {
    patch?: Record<string, unknown>;
  } | null;
  if (!input?.patch || typeof input.patch !== "object")
    return NextResponse.json({ error: "Send { patch }" }, { status: 400 });
  const { errors } = setHealthConfig(input.patch);
  if (errors.length)
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  return NextResponse.json(body());
}
