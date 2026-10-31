import { NextResponse } from "next/server";
import { z } from "zod";
import { readCapped } from "../security/read-capped";
import type { ChatViewInput } from "./types";

const MAX_BODY_BYTES = 2048;

const position = z.object({
  itemId: z.string().min(1).max(200).nullable(),
  offsetPx: z.number().int().min(-100000).max(100000),
  atEnd: z.boolean(),
  // False keeps `viewed_at` as it was: the reader left with newer items below
  // them that they haven't seen.
  advance: z.boolean().optional(),
});
const body = z.union([position, z.object({ viewed: z.literal(true) })]);

/** The PUT body: a position to save, `null` for "opened just now", or the
 * response that refuses it. */
export async function readViewBody(
  request: Request
): Promise<{ input: ChatViewInput | null } | NextResponse> {
  const raw = await readCapped(request, MAX_BODY_BYTES);
  if (raw === null)
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  let json: unknown = null;
  try {
    json = JSON.parse(raw);
  } catch {
    // Not JSON: refused below.
  }
  const parsed = body.safeParse(json);
  if (!parsed.success)
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return {
    input:
      "viewed" in parsed.data
        ? null
        : { ...parsed.data, advance: parsed.data.advance !== false },
  };
}
