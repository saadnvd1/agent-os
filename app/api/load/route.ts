import { NextResponse } from "next/server";
import { localFacts } from "@/lib/load/machines";

export const dynamic = "force-dynamic";

// This machine's load as the scheduler reads it, for another machine's
// AgentOS deciding whether to start a task here. No session names or paths.
// Before the monitor's first sample the level is null, which the asker
// reads as no reading (held), never as green.
export function GET() {
  const f = localFacts();
  return NextResponse.json({
    level: f.level,
    load1: f.load1,
    cores: f.cores,
    memUsedPct: f.memUsedPct,
    booted: f.booted,
    capabilities: f.capabilities,
  });
}
