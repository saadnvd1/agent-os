/**
 * The bucket a pairing claim counts against. Behind a proxy on this machine
 * every claim arrives from loopback, so the client it names is added. From
 * anywhere else a forwarded header is the caller's own choice and is
 * ignored; Connect streams all share "connect". The global cap in
 * pairing.ts applies either way.
 */
export function rateLimitKey(
  remote: string | null,
  forwardedFor: string | null
): string {
  const from = remote || "unknown";
  if (from !== "127.0.0.1" && from !== "::1") return from;
  const client = forwardedFor?.split(",")[0].trim();
  return client ? `${from}>${client}` : from;
}
