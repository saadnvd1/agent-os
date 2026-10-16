import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ENV_CLASSES } from "@/lib/health/env/classes";
import { setFix, MAX_FIX } from "@/lib/health/env/fixText";
import { envSessions, envSummary } from "@/lib/health/env/summarize";

const query = z.object({
  class: z
    .string()
    .refine((c) => ENV_CLASSES.some((k) => k.id === c))
    .optional(),
  days: z.coerce.number().int().min(1).max(90).default(30),
});

// GET /api/health/env-failures - sessions per class and project over the
// last 7 and 30 days. ?class=<id>[&days=30] lists that class's sessions.
export function GET(request: NextRequest) {
  const parsed = query.safeParse(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Unknown class or days" },
      { status: 400 }
    );
  const { class: cls, days } = parsed.data;
  return NextResponse.json(
    cls ? { sessions: envSessions(cls, days) } : envSummary()
  );
}

const patch = z.object({
  class: z.string(),
  fix: z.string().max(MAX_FIX).nullable(),
});

// PATCH /api/health/env-failures { class, fix } - this machine's own fix text
// for a class; null puts the default back.
export async function PATCH(request: NextRequest) {
  const body = patch.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json(
      {
        error: `Send { class, fix: text up to ${MAX_FIX} characters, or null }`,
      },
      { status: 400 }
    );
  if (!setFix(body.data.class, body.data.fix))
    return NextResponse.json({ error: "No such class" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
