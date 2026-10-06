import { NextRequest, NextResponse } from "next/server";
import { listMessages } from "@/lib/bus";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  return NextResponse.json({
    messages: listMessages({
      sessionId: params.get("session") ?? undefined,
      limit: Number(params.get("limit")) || undefined,
    }),
  });
}
