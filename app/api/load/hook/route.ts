import { NextRequest } from "next/server";
import { hookOutput } from "@/lib/load/advise";

// The Claude status hook forwards Bash tool calls that look heavy here; the
// body it gets back is printed to Claude as is. Never fails the hook: any
// trouble answers with nothing.
export async function POST(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const input = await request.json();
    const out = hookOutput(
      params.get("event") ?? "",
      params.get("session") || null,
      input && typeof input === "object" ? input : {}
    );
    return new Response(out, {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response("");
  }
}
