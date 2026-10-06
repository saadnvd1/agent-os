import { NextResponse, type NextRequest } from "next/server";
import { finishConnect } from "@/lib/lumifyhub/connection";
import { requestOrigin } from "@/lib/lumifyhub/http";

// LumifyHub sends the browser back here after the approve page.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const home = new URL("/", requestOrigin(request));
  try {
    await finishConnect({
      code: params.get("code"),
      state: params.get("state"),
      error: params.get("error"),
    });
    home.searchParams.set("lumifyhub", "connected");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[lumifyhub] connect failed: ${reason}`);
    home.searchParams.set("lumifyhub", "error");
  }
  return NextResponse.redirect(home, 303);
}
