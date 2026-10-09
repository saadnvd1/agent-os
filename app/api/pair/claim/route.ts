import { NextRequest, NextResponse } from "next/server";
import { claimPairing } from "@/lib/security/pairing";
import { REMOTE_HEADER } from "@/lib/security/auth";
import { rateLimitKey } from "@/lib/security/rate-limit-key";
import { deviceCookie, isHttps } from "@/lib/security/cookie";
import { MAX_CLAIM_BYTES, readCapped } from "@/lib/security/read-capped";
import {
  claimResponseBody,
  claimSetsCookie,
} from "@/lib/security/claim-response";

// POST /api/pair/claim - reachable without a token; trades a code for one.
// A client that isn't a browser sends `token: true` to get it in the body too.
export async function POST(request: NextRequest) {
  const raw = await readCapped(request, MAX_CLAIM_BYTES);
  if (raw === null)
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  let body: { code?: string; name?: string; token?: unknown } = {};
  try {
    body = JSON.parse(raw) ?? {};
  } catch {
    // Not JSON: no code.
  }
  if (!body.code)
    return NextResponse.json({ error: "code required" }, { status: 400 });
  const result = claimPairing({
    code: body.code,
    name: body.name ?? "",
    userAgent: request.headers.get("user-agent"),
    address: rateLimitKey(
      request.headers.get(REMOTE_HEADER),
      request.headers.get("x-forwarded-for")
    ),
  });
  if (!result.ok) {
    const status = result.error === "rate_limited" ? 429 : 400;
    const error =
      result.error === "rate_limited"
        ? "Too many tries. Wait a minute."
        : "That code is wrong, used or expired. Make a new one.";
    return NextResponse.json({ error }, { status });
  }
  const reply = claimResponseBody(
    { id: result.device.id, name: result.device.name },
    result.token,
    { wantsToken: body.token, origin: request.headers.get("origin") }
  );
  const res = NextResponse.json(reply);
  if (!claimSetsCookie(reply)) return res;
  const secure = isHttps(
    request.nextUrl.protocol === "https:",
    request.headers.get("x-forwarded-proto")
  );
  res.headers.set("Set-Cookie", deviceCookie(result.token, secure));
  return res;
}
