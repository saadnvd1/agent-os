import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { releaseLease, requestLease } from "@/lib/load/heavy-lease";

const body = z.object({
  session: z.string().nullish(),
  pid: z.number().int().positive(),
  // `renew` is a beat from a holder that may predate a server restart.
  action: z.enum(["request", "renew", "release"]).default("request"),
});

// `aos heavy` asks for a slot here and waits its turn: builds and test runs
// on this machine take turns. The CLI runs the command anyway when this
// can't answer.
export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "pid is required" }, { status: 400 });
  const { session = null, pid, action } = parsed.data;
  if (action === "release") {
    releaseLease(session, pid);
    return NextResponse.json({ released: true });
  }
  return NextResponse.json(
    requestLease(session, pid, Date.now(), action === "renew")
  );
}
