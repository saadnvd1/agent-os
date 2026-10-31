import { needsShrink, renamed, SHRINK_STEPS, targetSize } from "./shrinkPlan";

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

function encode(
  canvas: Canvas,
  type: string,
  quality?: number
): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function hasAlpha(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  w: number,
  h: number
) {
  const data = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

export type ShrinkResult = { ok: true; file: File } | { ok: false };

// Downscale an image that is over the byte cap or 2000px on its long edge.
// Returns the file untouched when it is already fine, and { ok: false } when
// it can't be decoded or still doesn't fit after every step.
export async function shrinkImage(
  file: File,
  cap: number
): Promise<ShrinkResult> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // A file we can't decode is only a problem if it was too big anyway.
    return file.size > cap ? { ok: false } : { ok: true, file };
  }
  try {
    if (!needsShrink(bitmap.width, bitmap.height, file.size, cap))
      return { ok: true, file };
    // Animated GIFs would lose their frames; only touch one that can't go as is.
    if (file.type === "image/gif" && file.size <= cap)
      return { ok: true, file };

    let keepPng: boolean | null = null;
    for (const { maxEdge, quality } of SHRINK_STEPS) {
      const { width, height } = targetSize(
        bitmap.width,
        bitmap.height,
        maxEdge
      );
      const canvas = makeCanvas(width, height);
      const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
      if (!ctx) return { ok: false };
      ctx.drawImage(bitmap, 0, 0, width, height);
      if (keepPng === null)
        keepPng = file.type === "image/png" && hasAlpha(ctx, width, height);
      if (keepPng) {
        const png = await encode(canvas, "image/png");
        if (png && png.size <= cap)
          return {
            ok: true,
            file: new File([png], file.name, { type: "image/png" }),
          };
        keepPng = false;
      }
      // JPEG has no alpha: put the picture on white first.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      const jpeg = await encode(canvas, "image/jpeg", quality);
      if (jpeg && jpeg.size <= cap)
        return {
          ok: true,
          file: new File([jpeg], renamed(file.name, "jpg"), {
            type: "image/jpeg",
          }),
        };
    }
    return { ok: false };
  } finally {
    bitmap.close();
  }
}
