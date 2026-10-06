import { NextRequest, NextResponse } from "next/server";
import { claimPairing } from "@/lib/security/pairing";
import { DEVICE_COOKIE, REMOTE_HEADER } from "@/lib/security/auth";

const YEAR = 365 * 24 * 60 * 60;

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
    address: request.headers.get(REMOTE_HEADER) ?? "unknown",
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
  res.cookies.set(DEVICE_COOKIE, result.token, {
    httpOnly: true,
    // Lax, not Strict: a tapped notification or link must arrive signed in.
    // Cross-site writes are already refused by net.ts.
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    maxAge: YEAR,
    path: "/",
  });
  return res;
}
