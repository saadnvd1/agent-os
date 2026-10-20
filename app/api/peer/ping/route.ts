import { NextResponse } from "next/server";
import { appVersion } from "@/lib/connect/heartbeat";

export const dynamic = "force-dynamic";

// What a linked machine asks first: which version answers, and which peer
// features it speaks. Nothing about this machine's sessions or paths.
export function GET() {
  return NextResponse.json({ version: appVersion(), capabilities: ["rpc-v1"] });
}
