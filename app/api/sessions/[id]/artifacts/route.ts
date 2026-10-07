import { NextResponse } from "next/server";
import { listArtifacts } from "@/lib/artifacts/store";

// GET /api/sessions/[id]/artifacts - the pages this session's agent showed
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const artifacts = listArtifacts(id).map((a) => ({
    id: a.id,
    title: a.title,
    createdAt: a.created_at,
    url: `/api/artifacts/${a.id}`,
  }));
  return NextResponse.json({ artifacts });
}
