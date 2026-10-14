import { NextResponse } from "next/server";
import { clientConfig } from "@/lib/config/client-config";

// GET /api/client-config - the labels and defaults a client renders with.
// Read-only; the app keeps its own cache, so the server never does.
export function GET() {
  return NextResponse.json(clientConfig(), {
    headers: { "Cache-Control": "no-store" },
  });
}
