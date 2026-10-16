import { NextResponse } from "next/server";
import { renderPdf, pdfAvailable } from "@/lib/share/pdf";
import { readJson, refuseDemo, fail, toResponse } from "@/lib/share/route";
import { TOO_BIG, buildPage, parseRequest } from "@/lib/share/service";
import { fileName } from "@/lib/share/view";

// POST /api/shares/pdf - the preview's page as a PDF. Same body as preview.
// Local work only; the response is application/pdf, named after the title.
export async function POST(request: Request) {
  const refused = refuseDemo();
  if (refused) return refused;
  const read = await readJson(request);
  if ("refused" in read) return read.refused;
  try {
    const req = parseRequest(read.body);
    if (!(await pdfAvailable()))
      return fail("PDF isn't available on this machine.", 501);
    const page = await buildPage(req);
    if (page.tooBig) return fail(TOO_BIG, 413);
    const pdf = await renderPdf(page.html);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName(page.title, "pdf")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return toResponse(err);
  }
}
