import { NextRequest, NextResponse } from "next/server";
import { modelAvailability } from "@/lib/models/availability-refs";

// GET /api/models/availability?refresh=1 - whether each local model's
// server answers now (ref to state). Cloud models aren't probed.
export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.has("refresh");
  return NextResponse.json(await modelAvailability(refresh));
}
