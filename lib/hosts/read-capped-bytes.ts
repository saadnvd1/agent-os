/** A response body, read no further than max bytes whatever it claims. */
export async function readCappedBytes(
  res: Response,
  max: number
): Promise<Buffer> {
  if (Number(res.headers.get("content-length")) > max)
    throw new Error("its answer is too large");
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error("its answer is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
