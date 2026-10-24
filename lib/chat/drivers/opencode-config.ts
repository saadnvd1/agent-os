import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

type P = Record<string, unknown>;

// How long OpenCode waits for a model server's response headers (its default
// is 5 minutes). A local model chewing through a long context sends nothing
// until it has read all of it, and a retry at the same limit fails the same
// way. The wait between chunks of a streamed reply keeps OpenCode's own 5
// minute limit, so a stream that started is judged on idle time and a server
// that never answers still ends the request.
export const HEADER_TIMEOUT_MS = 1_200_000;

// How long a turn may wait on the model with no sign of life before AgentOS
// stops it. Just past one header timeout: OpenCode would retry the same
// stall up to five more times, hours on a local model.
export const STALL_MS = HEADER_TIMEOUT_MS + 120_000;

const isObject = (v: unknown): v is P =>
  !!v && typeof v === "object" && !Array.isArray(v);

// JSON with comments and trailing commas (OpenCode's config allows both),
// parsed without touching what is inside strings. Null when it isn't JSON.
export function parseJsonc(text: string): P | null {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
    } else out += c;
  }
  try {
    const v: unknown = JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

function read(file: string): P | null {
  try {
    return parseJsonc(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function userConfigs(cwd: string, env: NodeJS.ProcessEnv): P[] {
  const home = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const files = [
    ...["opencode.json", "opencode.jsonc", "config.json"].map((f) =>
      path.join(home, "opencode", f)
    ),
    ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : []),
    ...["opencode.json", "opencode.jsonc"].flatMap((f) => [
      path.join(cwd, f),
      path.join(cwd, ".opencode", f),
    ]),
  ];
  return files.map(read).filter((c): c is P => !!c);
}

// The OPENCODE_CONFIG_CONTENT for one conversation: the user's own value
// (never replaced, their providers are in it) plus the edit guard plugin and
// a longer header wait for each provider in their config and for the
// conversation's model, unless they set one themselves.
export function openCodeConfigContent(o: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  // "provider/model", the conversation's.
  model?: string;
  pluginFile?: string;
}): string {
  const given = o.env.OPENCODE_CONFIG_CONTENT;
  const base = given ? parseJsonc(given) : {};
  if (!base) return given as string;

  const own = new Set<string>();
  const set = new Set<string>();
  const slash = o.model?.indexOf("/") ?? -1;
  if (o.model && slash > 0) set.add(o.model.slice(0, slash));
  for (const c of [...userConfigs(o.cwd, o.env), base]) {
    if (!isObject(c.provider)) continue;
    for (const [id, p] of Object.entries(c.provider)) {
      set.add(id);
      const options = isObject(p) && isObject(p.options) ? p.options : {};
      if (options.headerTimeout !== undefined) own.add(id);
    }
  }

  const provider: P = isObject(base.provider) ? { ...base.provider } : {};
  for (const id of set) {
    if (own.has(id)) continue;
    const p = isObject(provider[id]) ? (provider[id] as P) : {};
    const options = isObject(p.options) ? p.options : {};
    provider[id] = {
      ...p,
      options: { ...options, headerTimeout: HEADER_TIMEOUT_MS },
    };
  }

  const plugin = Array.isArray(base.plugin) ? [...base.plugin] : [];
  if (o.pluginFile) plugin.push(pathToFileURL(o.pluginFile).href);
  return JSON.stringify({ ...base, provider, plugin });
}
