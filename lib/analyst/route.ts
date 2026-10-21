import { NextResponse } from "next/server";
import type { z } from "zod";
import { ModelUnavailableError } from "../models/agent-binding";
import { AnalystError } from "./types";

// An analyst action for a route: a body that fails its schema is a 400, an
// AnalystError its status, a role model that's down a 409 with its fallback.
export async function analystRoute<S extends z.ZodType>(
  request: Request,
  schema: S,
  act: (body: z.infer<S>) => unknown
): Promise<NextResponse> {
  const raw = await request.text().catch(() => "");
  let json: unknown = {};
  try {
    json = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Bad request" },
      { status: 400 }
    );
  return run(() => act(parsed.data));
}

export async function run(act: () => unknown): Promise<NextResponse> {
  try {
    return NextResponse.json(await act());
  } catch (err) {
    if (err instanceof AnalystError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof ModelUnavailableError)
      return NextResponse.json(
        {
          code: err.code,
          role: err.role,
          ref: err.ref,
          fallback: err.fallback ?? null,
          error: err.message,
        },
        { status: 409 }
      );
    const message = err instanceof Error ? err.message : String(err);
    console.error("[analyst]", message);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
