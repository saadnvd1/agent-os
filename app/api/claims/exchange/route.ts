import { NextRequest, NextResponse } from "next/server";
import { acceptExchange, answerExchange } from "@/lib/claims/exchange";
import { exchangeBody } from "@/lib/claims/types";
import { readCapped } from "@/lib/security/read-capped";

export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024;

// POST /api/claims/exchange - a linked machine sends its claims and gets
// ours back. Paths and one-line goals only; the device-token gate applies.
export async function POST(request: NextRequest) {
  const raw = await readCapped(request, MAX_BYTES);
  if (raw === null)
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Not JSON" }, { status: 400 });
  }
  const body = exchangeBody.safeParse(json);
  if (!body.success)
    return NextResponse.json({ error: "Bad claims" }, { status: 400 });
  acceptExchange(body.data);
  return NextResponse.json(answerExchange(body.data));
}
