import { NextRequest, NextResponse } from "next/server";
import { fail, text } from "@/lib/fork/api";
import { cancelChildren } from "@/lib/fork/settle";

// Cancels one child (`ref`: its number, label or id) or all of a session's.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parent = text(body.from) ?? text(body.session);
    if (!parent) throw new Error("Which session's forks?");
    const ref = text(body.ref) ?? undefined;
    if (!ref && body.all !== true)
      throw new Error("Which fork, or all of them?");
    const done = await cancelChildren(parent, ref);
    return NextResponse.json({ cancelled: done.map((c) => c.label) });
  } catch (error) {
    return fail(error);
  }
}
