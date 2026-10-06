import { NextRequest, NextResponse } from "next/server";
import { claimPairing } from "@/lib/security/pairing";
import { REMOTE_HEADER } from "@/lib/security/auth";
import { deviceCookie, isHttps } from "@/lib/security/cookie";

// Behind a proxy on this machine every claim comes from loopback; key on the
// client it names too. Anywhere else the forwarded header is the caller's own
// choice, so it's ignored (Connect streams are all "connect"). The global
// cap in pairing.ts applies either way.
function rateLimitKey(request: NextRequest): string {
  const remote = request.headers.get(REMOTE_HEADER) ?? "unknown";
  if (remote !== "127.0.0.1" && remote !== "::1") return remote;
  const client = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
  return client ? `${remote}>${client}` : remote;
}

// POST /api/pair/claim - reachable without a token; trades a code for one
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    code?: string;
    name?: string;
  };
  if (!body.code)
    return NextResponse.json({ error: "code required" }, { status: 400 });
  const result = claimPairing({
    code: body.code,
    name: body.name ?? "",
    userAgent: request.headers.get("user-agent"),
    address: rateLimitKey(request),
  });
  if (!result.ok) {
    const status = result.error === "rate_limited" ? 429 : 400;
    const error =
      result.error === "rate_limited"
        ? "Too many tries. Wait a minute."
        : "That code is wrong, used or expired. Make a new one.";
    return NextResponse.json({ error }, { status });
  }
  const res = NextResponse.json({
    device: { id: result.device.id, name: result.device.name },
  });
  const secure = isHttps(
    request.nextUrl.protocol === "https:",
    request.headers.get("x-forwarded-proto")
  );
  res.headers.set("Set-Cookie", deviceCookie(result.token, secure));
  return res;
}
