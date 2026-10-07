import { NextRequest, NextResponse } from "next/server";
import { getCloneJob } from "@/lib/project-add";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ job: string }> }
) {
  const job = getCloneJob((await params).job);
  if (!job)
    return NextResponse.json({ error: "No such clone" }, { status: 404 });
  return NextResponse.json({ job });
}
