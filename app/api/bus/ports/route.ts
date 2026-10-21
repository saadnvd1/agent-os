import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensurePorts } from "@/lib/ports/ensurePorts";

const body = z.object({
  from: z.string().min(1),
  target: z
    .string()
    .regex(/^(\d{1,5}|[A-Za-z_][A-Za-z0-9_]*)$/)
    .optional(),
});

// POST /api/bus/ports { from, target? } - `aos port`: whether the caller's
// ports are free on this machine, who holds the ones that aren't, and a free
// one in place of each taken one.
export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Send { from: your session id, target?: a port name or number }",
      },
      { status: 400 }
    );
  const { from, target } = parsed.data;
  try {
    return NextResponse.json(await ensurePorts(from, target));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: /^No session /.test(message) ? 404 : 409 }
    );
  }
}
