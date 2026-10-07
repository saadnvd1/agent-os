// Third-party code the app needs inside WebViews (mermaid), fetched from
// the machine itself, never a CDN, and kept on the phone by its hash.
import { File, Paths } from "expo-file-system";
import { authHeaders } from "~/lib/api/client";
import type { Machine } from "~/lib/machines/store";

const memory = new Map<string, Promise<string>>();
const indexFile = () => new File(Paths.cache, "vendor-mermaid.json");

function readIndex(): Record<string, string> {
  try {
    const f = indexFile();
    return f.exists ? (JSON.parse(f.textSync()) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function load(machine: Machine): Promise<string> {
  const index = readIndex();
  const known = index[machine.id];
  const cachedFile = known
    ? new File(Paths.cache, `mermaid-${known}.js`)
    : null;
  const res = await fetch(`${machine.url}/api/vendor/mermaid`, {
    headers: {
      ...authHeaders(machine),
      ...(cachedFile?.exists ? { "If-None-Match": `"${known}"` } : {}),
    },
  });
  if (res.status === 304 && cachedFile?.exists) return cachedFile.textSync();
  if (!res.ok) throw new Error(`mermaid: ${res.status}`);
  const js = await res.text();
  const sha = (res.headers.get("etag") ?? "").replace(/"/g, "");
  if (/^[0-9a-f]{64}$/.test(sha)) {
    new File(Paths.cache, `mermaid-${sha}.js`).write(js);
    indexFile().write(JSON.stringify({ ...index, [machine.id]: sha }));
  }
  return js;
}

export function mermaidScript(machine: Machine): Promise<string> {
  let p = memory.get(machine.id);
  if (!p) {
    p = load(machine).catch((err) => {
      memory.delete(machine.id);
      throw err;
    });
    memory.set(machine.id, p);
  }
  return p;
}
