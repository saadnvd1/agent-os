import { NextResponse } from "next/server";
import { ownerName, setOwnerName } from "@/lib/owner";

// GET /api/owner - the name the owner gave, or null.
export function GET() {
  return NextResponse.json({ name: ownerName() });
}

// PUT /api/owner { name } - set it; blank or null clears it.
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  if (!body || (body.name !== null && typeof body.name !== "string"))
    return NextResponse.json({ error: "name must be text" }, { status: 400 });
  return NextResponse.json({ name: setOwnerName(body.name) });
}
