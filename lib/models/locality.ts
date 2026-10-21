/**
 * Whether a model endpoint is on this machine's own networks (local) or
 * out on the internet (cloud), read from its host, never from a name.
 * Imported by the browser too.
 */

export type Locality = "local" | "cloud";

const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  // The tailnet: 100.64.0.0/10.
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

export function hostLocality(url: string | null | undefined): Locality {
  if (!url) return "cloud";
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "cloud";
  }
  host = host.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost"))
    return "local";
  if (host.endsWith(".local") || host.endsWith(".ts.net")) return "local";
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return "local";
  return PRIVATE_V4.some((re) => re.test(host)) ? "local" : "cloud";
}
