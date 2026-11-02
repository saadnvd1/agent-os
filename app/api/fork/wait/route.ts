import { NextRequest, NextResponse } from "next/server";
import { fail, text } from "@/lib/fork/api";
import { FORKS_OFF, forksOn } from "@/lib/fork/options";
import { registerForkWait } from "@/lib/fork/waits";
import { parseTimeout } from "@/lib/bus/waits/register";
import { kickForks } from "@/lib/fork/tick";

// `aos wait children --all|--any [--timeout 30m]`: records the wait and
// returns; the parent is woken with the results.
export async function POST(request: NextRequest) {
  try {
    if (!forksOn()) throw new Error(FORKS_OFF);
    const body = await request.json();
    const parent = text(body.from);
    if (!parent) throw new Error("Only a session can wait on its forks");
    const mode = body.mode === "any" ? "any" : "all";
    const r = registerForkWait(
      parent,
      mode,
      parseTimeout(body.timeout == null ? null : String(body.timeout))
    );
    kickForks();
    return NextResponse.json(r);
  } catch (error) {
    return fail(error);
  }
}
