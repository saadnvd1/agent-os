import { NextResponse } from "next/server";
import { releaseAnyway } from "@/lib/plans/release";

// A blocked piece stops waiting on what held it and starts on the next sweep.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !releaseAnyway(id))
    return NextResponse.json(
      { error: "That piece isn't blocked" },
      { status: 409 }
    );
  return NextResponse.json({ success: true });
}
