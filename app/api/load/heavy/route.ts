import { NextRequest, NextResponse } from "next/server";
import { adviseHeavy } from "@/lib/load/advise";
import { heavyLabel, programName } from "@/lib/load/heavy";

// `aos heavy -- <cmd>`: the command is already running; register it and say
// what else is.
export async function POST(request: NextRequest) {
  try {
    const { session = null, pid, command } = await request.json();
    const text = String(command ?? "").trim();
    if (!text || !Number.isInteger(pid) || pid <= 0)
      return NextResponse.json(
        { error: "pid and command are required" },
        { status: 400 }
      );
    const note = adviseHeavy({
      key: `pid:${pid}`,
      sessionId: session === null ? null : String(session),
      // Only a program's name reaches other agents, never its arguments.
      label: heavyLabel(text) ?? (programName(text) || "command"),
      pid,
    });
    return NextResponse.json({ note });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
