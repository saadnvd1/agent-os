import { NextRequest, NextResponse } from "next/server";
import { demoMode } from "@/lib/security/demo";
import { completeWelcome, readWelcomeGate } from "@/lib/welcome";

// Whether the first-run welcome should open on this server. An install
// already in use is marked done here, so emptying it later doesn't bring it back.
export async function GET() {
  return NextResponse.json(readWelcomeGate(demoMode()));
}

// { action: "complete" }: setup finished or skipped.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body?.action !== "complete") throw new Error("Unknown action");
    completeWelcome(new Date().toISOString(), undefined, true);
    return NextResponse.json(readWelcomeGate(demoMode()));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
