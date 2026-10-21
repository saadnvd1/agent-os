import { NextResponse } from "next/server";
import { parseExportRequest } from "@/lib/export/request";
import { buildFile } from "@/lib/export/service";
import { TOO_BIG, exportFileName } from "@/lib/export/view";
import { fail, readJson, refuseDemo, toResponse } from "@/lib/share/route";

// POST /api/sessions/:id/export - the session (or a range of its turns) as a
// Markdown, JSON or HTML file, redacted. Local work only.
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
    const file = await buildFile(id, req);
    if (file.tooBig) return fail(TOO_BIG, 413);
    return new NextResponse(file.body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${exportFileName(file.title, file.slug, req.format)}"`,
        "Cache-Control": "no-store",
        "X-Export-Bytes": String(file.bytes),
        "X-Export-Tokens": String(file.tokens),
      },
    });
  } catch (err) {
    return toResponse(err);
  }
}
