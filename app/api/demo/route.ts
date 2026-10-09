import { NextResponse } from "next/server";
import { demoMode } from "@/lib/security/demo";

// GET /api/demo - whether this server is a demo (AGENTOS_DEMO=1), so the UI
// can show a notice where terminals and new sessions would be.
export async function GET() {
  return NextResponse.json({ demo: demoMode() });
}
