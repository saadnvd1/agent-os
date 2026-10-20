import { NextResponse } from "next/server";
import type { z } from "zod";
import { GROUP_STATUS, GroupError } from "./types";

// Runs a group action for a route: a body that fails its schema is a 400, a
// GroupError becomes its status code.
export async function groupRoute<S extends z.ZodType>(
  request: Request,
  schema: S,
  act: (body: z.infer<S>) => unknown
): Promise<NextResponse> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Bad request" },
      { status: 400 }
    );
  return run(() => act(parsed.data));
}

export function run(act: () => unknown): NextResponse {
  try {
    return NextResponse.json(act());
  } catch (err) {
    if (err instanceof GroupError)
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: GROUP_STATUS[err.code] }
      );
    throw err;
  }
}
