import type { NextRequest } from "next/server";
import { startConnect } from "@/lib/lumifyhub/connection";
import { requestOrigin, respond } from "@/lib/lumifyhub/http";

export async function POST(request: NextRequest) {
  return respond(() => startConnect(requestOrigin(request)));
}
