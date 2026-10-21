import { NextResponse } from "next/server";
import { parseExportRequest } from "@/lib/export/request";
import { estimate } from "@/lib/export/service";
import { readJson, refuseDemo, toResponse } from "@/lib/share/route";

// POST /api/sessions/:id/export/estimate - what an export would hold: size,
// tokens, the turns to pick from, and warnings. No file text.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const refused = refuseDemo();
  if (refused) return refused;
  const read = await readJson(request);
  if ("refused" in read) return read.refused;
  try {
    const { id } = await params;
    const req = parseExportRequest(read.body);
    return NextResponse.json(await estimate(id, req));
  } catch (err) {
    return toResponse(err);
  }
}
