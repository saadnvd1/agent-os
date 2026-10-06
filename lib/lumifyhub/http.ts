import { NextResponse, type NextRequest } from "next/server";
import { LumifyHubError } from "./client";
import { forgetIfDisconnected } from "./connection";

// Run a route body, turning failures into `{ error }` with a fitting status.
export async function respond<T>(fn: () => T | Promise<T>) {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    forgetIfDisconnected(error);
    const message = error instanceof Error ? error.message : String(error);
    const status =
      error instanceof LumifyHubError
        ? error.disconnected
          ? 401
          : error.status === 0
            ? 502
            : error.status
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

// The origin the browser reached AgentOS on. The Host header has already
// been checked against the access policy by the server.
export function requestOrigin(request: NextRequest): string {
  const host = request.headers.get("host") || request.nextUrl.host;
  const proto =
    request.headers.get("x-forwarded-proto") ||
    request.nextUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

export async function body<T>(request: NextRequest): Promise<Partial<T>> {
  return (await request.json().catch(() => ({}))) as Partial<T>;
}
