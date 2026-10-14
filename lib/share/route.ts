import { NextResponse } from "next/server";
import { demoMode } from "@/lib/security/demo";
import { readCapped } from "@/lib/security/read-capped";
import { BadShare } from "./service";
import { ShareError } from "./connect";

const MAX_BODY = 64 * 1024;

export const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

export const refuseDemo = () =>
  demoMode() ? fail("Not in the demo.", 403) : null;

/** The JSON body, capped, or a response saying why not. */
export async function readJson(
  request: Request
): Promise<{ body: unknown } | { refused: NextResponse }> {
  const text = await readCapped(request, MAX_BODY);
  if (text === null) return { refused: fail("Request too large.", 413) };
  try {
    return { body: text ? JSON.parse(text) : {} };
  } catch {
    return { refused: fail("Invalid JSON.", 400) };
  }
}

export function toResponse(err: unknown): NextResponse {
  if (err instanceof BadShare || err instanceof ShareError)
    return fail(err.message, err.status);
  console.error(`share: ${(err as Error)?.message ?? err}`);
  return fail("Couldn't share that.", 500);
}
