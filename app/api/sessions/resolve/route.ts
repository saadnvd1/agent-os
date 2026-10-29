import { NextRequest, NextResponse } from "next/server";
import { refFromParams, resolveSessionRef } from "@/lib/sessions/resolve";

// GET /api/sessions/resolve?ref=<id8|id>[&slug=] - the session a link names,
// archived ones included: {id, name, archived}.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const ref = refFromParams(params.get("ref"), params.get("slug"));
  if (!ref) return NextResponse.json({ error: "bad ref" }, { status: 400 });
  const session = resolveSessionRef(ref);
  if (!session)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(session);
}
