// Turning what someone types into a machine's base URL.

const TAILNET_V4 = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/;
const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;

export type ParsedUrl =
  { ok: true; url: string } | { ok: false; error: string };

export function normalizeMachineUrl(input: string): ParsedUrl {
  let raw = input.trim();
  if (!raw) return { ok: false, error: "Enter the machine's address." };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const host = raw.split(/[/:]/)[0].toLowerCase();
    const plain =
      IPV4.test(host) || host === "localhost" || /\.local$/.test(host);
    raw = `${plain ? "http" : "https"}://${raw}`;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "That isn't a valid address." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, error: "Use an http or https address." };
  if (!url.hostname) return { ok: false, error: "That address has no host." };
  const port = url.port ? `:${url.port}` : "";
  return {
    ok: true,
    url: `${url.protocol}//${url.hostname.toLowerCase()}${port}`,
  };
}

export function socketUrl(base: string, path: string): string {
  return base.replace(/^http/, "ws") + path;
}

// A short label for a machine, from its address.
export function machineLabel(base: string): string {
  const host = new URL(base).hostname;
  if (IPV4.test(host)) return host;
  return host.split(".")[0];
}

export const isTailnetIp = (host: string) => TAILNET_V4.test(host);

// A pairing link from the web's "Add a device" (<base>/pair#CODE) carries
// the code in its fragment; pasting one fills in both fields.
export function pairLinkCode(input: string): string | null {
  const m = input.trim().match(/\/pair#([0-9A-Za-z-]{16,24})$/);
  return m ? m[1].toUpperCase() : null;
}
