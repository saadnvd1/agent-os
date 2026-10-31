import { NextResponse } from "next/server";
import { bootId } from "@/lib/reach/probeConnect";

// GET /api/reach/probe - public: the same answer for anyone, all boot long.
// This machine fetches it through its own Connect address to prove the
// answer came from this process, not a cache or another AgentOS.
export function GET() {
  return NextResponse.json(
    { ok: true, boot: bootId() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
