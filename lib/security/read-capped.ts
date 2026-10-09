/**
 * A request body read with a ceiling, counted as it streams in (a
 * Content-Length can be left out or wrong). For routes anyone can reach.
 */

// /api/pair/claim takes a code and a device name.
export const MAX_CLAIM_BYTES = 4096;

/** The body as text, or null once it passes `max` bytes. */
export async function readCapped(
  request: Request,
  max: number
): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
