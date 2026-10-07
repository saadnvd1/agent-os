import { NextRequest, NextResponse } from "next/server";
import { mermaidAsset } from "@/lib/vendor/mermaid";

// GET /api/vendor/mermaid - the mermaid bundle, for the phone app's diagrams
// (behind the device gate like every /api route; never a third-party CDN)
export async function GET(request: NextRequest) {
  const asset = await mermaidAsset();
  const etag = `"${asset.sha256}"`;
  const headers = {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "private, max-age=86400",
    ETag: etag,
    "X-Mermaid-Version": asset.version,
  };
  if (request.headers.get("if-none-match") === etag)
    return new NextResponse(null, { status: 304, headers });
  return new NextResponse(new Uint8Array(asset.body), { headers });
}
