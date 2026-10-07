import { NextRequest, NextResponse } from "next/server";
import { readImage } from "@/lib/artifacts/images";
import { IMAGE_CSP } from "@/lib/artifacts/serve";

// GET /api/files/image?path=... - an image file an agent wrote, to show in
// chat. Images only; SVG is served sandboxed.
export async function GET(request: NextRequest) {
  const image = readImage(request.nextUrl.searchParams.get("path") ?? "");
  if (!image)
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.type,
      "Content-Security-Policy": IMAGE_CSP,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-cache",
    },
  });
}
