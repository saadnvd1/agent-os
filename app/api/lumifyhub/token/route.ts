import type { NextRequest } from "next/server";
import { connectWithToken } from "@/lib/lumifyhub/connection";
import { body, respond } from "@/lib/lumifyhub/http";

export async function POST(request: NextRequest) {
  const { token } = await body<{ token: string }>(request);
  return respond(() => connectWithToken(token ?? ""));
}
