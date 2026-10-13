import { NextRequest, NextResponse } from "next/server";
import { runSimulator, simulatorLogs } from "@/lib/simulator";
import { simulatorFailure } from "@/lib/simulator/http";

// POST /api/sessions/[id]/simulator/run - one allow-listed agent-device call
// on the task's own simulator, or its recent app log: { args } | { logs }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      args?: unknown;
      logs?: unknown;
    };
    if (typeof body.logs === "string")
      return NextResponse.json({
        stdout: await simulatorLogs(id, body.logs),
        stderr: "",
        code: 0,
        screenshot: null,
      });
    if (
      !Array.isArray(body.args) ||
      !body.args.length ||
      !body.args.every((a) => typeof a === "string")
    )
      return NextResponse.json(
        { error: "args must be a list of strings" },
        { status: 400 }
      );
    return NextResponse.json(await runSimulator(id, body.args as string[]));
  } catch (error) {
    return simulatorFailure(error);
  }
}
