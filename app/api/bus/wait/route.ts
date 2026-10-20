import { NextRequest, NextResponse } from "next/server";
import { registerWait } from "@/lib/bus/waits/register";

// `aos wait <session> --until idle|merged|reply`: records the wait and
// returns; the sweep wakes the sender when it holds (lib/bus/waits/tick).
export async function POST(request: NextRequest) {
  try {
    const { from, to, until, timeout } = await request.json();
    if (typeof from !== "string" || !from)
      throw new Error("aos wait runs from inside an AgentOS session");
    const result = await registerWait({
      fromId: from,
      to: String(to ?? ""),
      until: String(until ?? ""),
      timeout: timeout == null ? null : String(timeout),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
