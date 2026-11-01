// A HAR is a browser's network log: it carries live cookies and bearer
// tokens. On the way in the values of the credential headers and every
// cookie are replaced; names, URLs, timings, bodies and statuses stay.

export const REDACTED = "[redacted]";

const SECRET_HEADER =
  /^(cookie|set-cookie|authorization|proxy-authorization)$|api[-_]?key|token|secret|^x-(csrf|xsrf)/i;

interface Pair {
  name?: unknown;
  value?: unknown;
}

interface Message {
  headers?: Pair[];
  cookies?: Pair[];
  status?: number;
  bodySize?: number;
  content?: { size?: number };
}

interface Entry {
  request?: Message & { method?: string; url?: string };
  response?: Message;
  time?: number;
}

export interface HarResult {
  json: string;
  redacted: number;
  summary: string;
}

function scrub(list: Pair[] | undefined, always: boolean): number {
  let n = 0;
  if (!Array.isArray(list)) return n;
  for (const p of list) {
    if (!p || typeof p !== "object" || p.value === REDACTED) continue;
    if (always || (typeof p.name === "string" && SECRET_HEADER.test(p.name))) {
      p.value = REDACTED;
      n++;
    }
  }
  return n;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "(unparsed)";
  }
};

const top = (counts: Map<string, number>, n: number) =>
  [...counts].sort((a, b) => b[1] - a[1]).slice(0, n);

function summarize(entries: Entry[]): string {
  const hosts = new Map<string, number>();
  const statuses = new Map<string, number>();
  const rows = entries.map((e) => {
    const url = e.request?.url ?? "";
    const status = e.response?.status ?? 0;
    const host = hostOf(url);
    hosts.set(host, (hosts.get(host) ?? 0) + 1);
    const klass = status >= 100 ? `${Math.floor(status / 100)}xx` : "failed";
    statuses.set(klass, (statuses.get(klass) ?? 0) + 1);
    const size = Math.max(
      e.response?.content?.size ?? 0,
      e.response?.bodySize ?? 0
    );
    const line = `${e.request?.method ?? "?"} ${url.slice(0, 160)} -> ${status || "no response"}`;
    return { line, size, status, time: e.time ?? 0 };
  });
  const failing = rows.filter((r) => r.status === 0 || r.status >= 400);
  const largest = [...rows].sort((a, b) => b.size - a.size).slice(0, 5);
  const lines = [
    `HAR summary: ${entries.length} requests, ${hosts.size} hosts.`,
    `Hosts: ${top(hosts, 8)
      .map(([h, c]) => `${h} (${c})`)
      .join(", ")}`,
    `Status: ${[...statuses]
      .sort()
      .map(([k, c]) => `${k} ${c}`)
      .join(", ")}`,
    `Largest responses: ${largest.map((r) => `${r.line} [${r.size} B]`).join("; ")}`,
    failing.length
      ? `Failing (${failing.length}${failing.length > 8 ? ", first 8" : ""}): ${failing
          .slice(0, 8)
          .map((r) => r.line)
          .join("; ")}`
      : "Failing: none",
    "Cookie and auth header values were replaced with [redacted].",
  ];
  return lines.join("\n");
}

/** The HAR with its secrets replaced and a short summary, or null when the text isn't a HAR. */
export function redactHar(text: string): HarResult | null {
  let har: { log?: { entries?: Entry[] } };
  try {
    har = JSON.parse(text);
  } catch {
    return null;
  }
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) return null;
  let redacted = 0;
  for (const e of entries) {
    for (const m of [e?.request, e?.response]) {
      if (!m || typeof m !== "object") continue;
      redacted += scrub(m.headers, false) + scrub(m.cookies, true);
    }
  }
  // Indented, so the agent can grep and read it by line.
  return {
    json: JSON.stringify(har, null, 1),
    redacted,
    summary: summarize(entries.filter((e) => e && typeof e === "object")),
  };
}
