import { NextResponse } from "next/server";
import { pdfAvailable } from "@/lib/share/pdf";
import { linked } from "@/lib/share/connect";
import { readJson, refuseDemo, toResponse } from "@/lib/share/route";
import type { ShareFormat } from "@/lib/share/view";
import { buildPage, parseRequest } from "@/lib/share/service";

// POST /api/shares/preview - exactly what a share would upload, redacted.
// Local work only: nothing goes to Connect until a share is created.
export async function POST(request: Request) {
  const refused = refuseDemo();
  if (refused) return refused;
  const read = await readJson(request);
  if ("refused" in read) return read.refused;
  try {
    const req = parseRequest(read.body);
    const page = await buildPage(req);
    const formats: ShareFormat[] = ["html", "md"];
    if (await pdfAvailable()) formats.unshift("pdf");
    return NextResponse.json({
      html: page.html,
      markdown: page.markdown,
      title: page.title,
      bytes: page.bytes,
      hash: page.hash,
      sharedAt: req.sharedAt,
      items: page.items,
      hits: page.hits,
      tooBig: page.tooBig,
      connectLinked: linked(),
      formats,
    });
  } catch (err) {
    return toResponse(err);
  }
}
