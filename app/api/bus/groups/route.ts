import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { groupCommand } from "@/lib/session-groups/cli";
import { GROUP_STATUS, GroupError } from "@/lib/session-groups";

const refs = z.array(z.string().min(1)).min(1);
const body = z.object({
  from: z.string().min(1, "aos group runs from inside an AgentOS session"),
  command: z.discriminatedUnion("action", [
    z.object({ action: z.literal("list") }),
    z.object({ action: z.literal("new"), name: z.string() }),
    z.object({
      action: z.literal("rename"),
      group: z.string(),
      name: z.string(),
    }),
    z.object({
      action: z.literal("add"),
      group: z.string(),
      sessions: refs,
    }),
    z.object({ action: z.literal("rm"), sessions: refs }),
  ]),
});

// POST /api/bus/groups { from, command } - `aos group …`, scoped to the
// asking session's workspace like `aos read`.
export async function POST(request: NextRequest) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Bad request" },
      { status: 400 }
    );
  try {
    return NextResponse.json({
      summary: groupCommand(parsed.data.from, parsed.data.command),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof GroupError ? GROUP_STATUS[error.code] : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
