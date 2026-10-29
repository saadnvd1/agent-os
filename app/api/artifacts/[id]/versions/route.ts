import { NextResponse } from "next/server";
import { pageVersions } from "@/lib/artifacts/versions";
import { pdfAvailable } from "@/lib/share/pdf";

// GET /api/artifacts/[id]/versions - every version of the page this is one
// of, oldest first, and what can be done with it
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const page = pageVersions(id, { pdf: await pdfAvailable() });
  if (!page)
    return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
  return NextResponse.json(page);
}
