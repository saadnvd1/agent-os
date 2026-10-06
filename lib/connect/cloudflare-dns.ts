/**
 * Dev and operator path only: write ACME TXT records straight to Cloudflare
 * with a zone-scoped token. Machines in the wild will go through the control
 * plane's broker instead, which only lets a machine touch its own name.
 */

import type { DnsChallenge } from "./enrol";

const API = "https://api.cloudflare.com/client/v4";

export function cloudflareDns(token: string, zone: string): DnsChallenge {
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const body = (await res.json()) as {
      success: boolean;
      result: unknown;
      errors: unknown;
    };
    if (!body.success)
      throw new Error(`cloudflare: ${JSON.stringify(body.errors)}`);
    return body.result;
  };
  let zoneId: string | null = null;
  const zid = async () =>
    (zoneId ??=
      ((await call(`/zones?name=${zone}`)) as { id: string }[])[0]?.id ?? null);

  return {
    async set(name, value) {
      await call(`/zones/${await zid()}/dns_records`, {
        method: "POST",
        body: JSON.stringify({ type: "TXT", name, content: value, ttl: 60 }),
      });
      // Give the authoritative servers a moment before Let's Encrypt looks.
      await new Promise((r) => setTimeout(r, 15_000));
    },
    async clear(name, value) {
      const records = (await call(
        `/zones/${await zid()}/dns_records?type=TXT&name=${encodeURIComponent(name)}`
      )) as { id: string; content: string }[];
      for (const r of records.filter(
        (r) => r.content.replace(/"/g, "") === value
      )) {
        await call(`/zones/${await zid()}/dns_records/${r.id}`, {
          method: "DELETE",
        });
      }
    },
  };
}
