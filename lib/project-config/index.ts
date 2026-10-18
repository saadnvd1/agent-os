/**
 * The one reader of a project's config: `agentos.json` and `.dispatch.json`
 * together, else the legacy `.agent-os/worktrees.json` / `.agent-os.json`
 * (the first of those that exists). A broken file is an error, never a
 * reason to read the next or to ignore it.
 *
 * When both agentos.json and .dispatch.json exist they merge by top-level
 * key: agentos.json wins any key it sets, and its value replaces
 * .dispatch.json's whole (no deep merge, so a partial `browse` never mixes
 * with the old one); keys only .dispatch.json has still apply, after its
 * normalization (`workspace` becomes `cards.workspace`, dispatch-only keys
 * are dropped). `inherited` names those keys and `warning` says to move them.
 * Design: docs/decisions/2026-10-10-agentos-json.md.
 */

import * as fs from "fs";
import * as path from "path";
import type { z } from "zod";
import {
  agentosFields,
  agentosJson,
  dispatchFields,
  dispatchJson,
  legacyJson,
  mergedJson,
  RESERVED_ENV,
  type ProjectConfig,
} from "./schema";

export type { ProjectConfig } from "./schema";

export const CONFIG_FILES = [
  "agentos.json",
  ".dispatch.json",
  path.join(".agent-os", "worktrees.json"),
  ".agent-os.json",
] as const;

// What a session gets when its project declares no ports.
export const DEFAULT_PORTS: Record<string, number> = { PORT: 3100 };

export interface LoadedConfig {
  config: ProjectConfig;
  // The file it came from, relative to the project; null when there is none.
  source: string | null;
  // Why the file was refused, naming it and every bad field.
  error: string | null;
  // Top-level keys that came from .dispatch.json because agentos.json lacks
  // them; empty unless both files exist.
  inherited: string[];
  // One line for the brief when both files exist; null otherwise.
  warning: string | null;
}

export const NONE: LoadedConfig = Object.freeze({
  config: {},
  source: null,
  error: null,
  inherited: Object.freeze([]) as unknown as string[],
  warning: null,
});

function describe(file: string, error: z.ZodError): string {
  const fields = error.issues.map((i) => {
    const at = i.path.join(".");
    const keys =
      i.code === "unrecognized_keys" ? ` (${i.keys.join(", ")})` : "";
    // A bad record key (an env name) carries its rule one level down.
    const message =
      i.code === "invalid_key" && i.issues[0] ? i.issues[0].message : i.message;
    return `${at || "(top level)"}: ${message}${keys}`;
  });
  return `${file} is invalid: ${fields.join("; ")}`;
}

function fromLegacy(raw: z.infer<typeof legacyJson>): ProjectConfig {
  const config: ProjectConfig = {};
  if (raw.setup?.length) config.setup = raw.setup;
  if (raw.devServer) {
    config.dev = raw.devServer.command;
    config.ports = { [raw.devServer.portEnvVar || "PORT"]: DEFAULT_PORTS.PORT };
  }
  return config;
}

// `checked: false` leaves the port-name check to the merge, which can see
// the ports the other file declares.
function parse(file: string, text: string, checked = true): LoadedConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ...NONE,
      source: file,
      error: `${file} is not valid JSON: ${(e as Error).message}`,
    };
  }
  if (file === "agentos.json") {
    const got = (checked ? agentosJson : agentosFields).safeParse(raw);
    return got.success
      ? { ...NONE, config: got.data, source: file }
      : { ...NONE, source: file, error: describe(file, got.error) };
  }
  if (file === ".dispatch.json") {
    const got = (checked ? dispatchJson : dispatchFields).safeParse(raw);
    if (!got.success)
      return { ...NONE, source: file, error: describe(file, got.error) };
    const { workspace, ...config } = got.data;
    if (workspace && !config.cards?.workspace)
      config.cards = { ...config.cards, workspace };
    return { ...NONE, config, source: file };
  }
  const got = legacyJson.safeParse(raw);
  return got.success
    ? { ...NONE, config: fromLegacy(got.data), source: file }
    : { ...NONE, source: file, error: describe(file, got.error) };
}

export const bothFilesWarning = (inherited: string[]): string =>
  `This repo has both agentos.json and .dispatch.json; keys ${inherited.join(", ")} come from .dispatch.json. Move them into agentos.json and delete .dispatch.json.`;

function merge(agentos: ProjectConfig, dispatch: ProjectConfig): LoadedConfig {
  const inherited = Object.keys(dispatch).filter((k) => !(k in agentos));
  const config = {
    ...Object.fromEntries(
      inherited.map((k) => [k, dispatch[k as keyof ProjectConfig]])
    ),
    ...agentos,
  } as ProjectConfig;
  const got = mergedJson.safeParse(config);
  if (!got.success)
    return {
      ...NONE,
      source: "agentos.json",
      error: describe("agentos.json with .dispatch.json", got.error),
    };
  return {
    ...NONE,
    config,
    source: "agentos.json",
    inherited,
    warning: inherited.length ? bothFilesWarning(inherited) : null,
  };
}

function statOf(projectPath: string, file: string): fs.Stats | null {
  try {
    const stat = fs.statSync(path.join(projectPath, file));
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function readFile(projectPath: string, file: string): string | LoadedConfig {
  try {
    return fs.readFileSync(path.join(projectPath, file), "utf-8");
  } catch (e) {
    return {
      ...NONE,
      source: file,
      error: `${file} could not be read: ${(e as Error).message}`,
    };
  }
}

// Both files, merged. A broken one is the error, whichever it is.
function loadBoth(projectPath: string): LoadedConfig {
  const parsed: LoadedConfig[] = [];
  for (const file of ["agentos.json", ".dispatch.json"]) {
    const text = readFile(projectPath, file);
    if (typeof text !== "string") return text;
    const got = parse(file, text, false);
    if (got.error) return got;
    parsed.push(got);
  }
  return merge(parsed[0].config, parsed[1].config);
}

// Keyed on the project; reused while the file's mtime and size hold, since
// agentEnv reads it for every terminal and chat start.
const cache = new Map<string, { stamp: string; loaded: LoadedConfig }>();

export function loadProjectConfig(projectPath: string): LoadedConfig {
  const a = statOf(projectPath, "agentos.json");
  const d = statOf(projectPath, ".dispatch.json");
  if (a && d) {
    const stamp = `both:${a.mtimeMs}:${a.size}:${d.mtimeMs}:${d.size}`;
    const hit = cache.get(projectPath);
    if (hit?.stamp === stamp) return hit.loaded;
    const loaded = loadBoth(projectPath);
    cache.set(projectPath, { stamp, loaded });
    return loaded;
  }
  for (const file of CONFIG_FILES) {
    const full = path.join(projectPath, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const stamp = `${file}:${stat.mtimeMs}:${stat.size}`;
    const hit = cache.get(projectPath);
    if (hit?.stamp === stamp) return hit.loaded;
    const text = readFile(projectPath, file);
    if (typeof text !== "string") return text;
    const loaded = parse(file, text);
    cache.set(projectPath, { stamp, loaded });
    return loaded;
  }
  cache.delete(projectPath);
  return NONE;
}

export const portBases = (config: ProjectConfig): Record<string, number> =>
  config.ports && Object.keys(config.ports).length
    ? config.ports
    : DEFAULT_PORTS;

export const notesOf = (notes: ProjectConfig["notes"]): string[] =>
  (typeof notes === "string" ? [notes] : (notes ?? [])).filter((n) => n.trim());

// `$NAME` / `${NAME}` of the session's ports, put in place. Only ports:
// `env` values are never written into anything the agent reads.
export function withPorts(
  text: string,
  ports: Record<string, number | string>
): string {
  return text.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (whole, a, b) => {
      const value = ports[a ?? b];
      return value === undefined ? whole : String(value);
    }
  );
}

// The port a `ready` or `browse` names, else the first one declared.
export function portFor(
  name: string | undefined,
  ports: Record<string, number>
): number | null {
  const key = name ?? Object.keys(ports)[0];
  return key !== undefined ? (ports[key] ?? null) : null;
}

// A command that exits 0 once the dev server is up, or null.
export function readyCommand(
  config: ProjectConfig,
  ports: Record<string, number>
): string | null {
  const ready = config.ready;
  if (!ready) return null;
  if (ready.check?.trim()) return withPorts(ready.check.trim(), ports);
  const url = ready.url?.trim();
  if (!url) return null;
  let full = url;
  if (!/^https?:\/\//.test(url)) {
    const port = portFor(ready.port, ports);
    if (!port) return null;
    full = `http://localhost:${port}${url.startsWith("/") ? "" : "/"}${url}`;
  }
  const curl = `curl -sf ${shellWord(full)}`;
  return ready.contains
    ? `${curl} | grep -q ${shellWord(ready.contains)}`
    : `${curl} >/dev/null`;
}

const shellWord = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// The project's `env`, then the ports over it: a project can't move a
// session onto another's port by naming it in `env`.
export function projectEnv(
  config: ProjectConfig,
  ports: Record<string, number> | null
): Record<string, string> {
  // Refused by the schema too; this covers a config read any other way.
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(config.env ?? {}).filter(
      ([name]) => !RESERVED_ENV.test(name)
    )
  );
  for (const [name, port] of Object.entries(ports ?? {}))
    env[name] = String(port);
  return env;
}

export const DEFAULT_VIEWPORTS = ["1440x900", "390x844"];

// The sizes a UI change is checked at: the project's, else desktop and phone.
export const viewportsOf = (browse: ProjectConfig["browse"]): string[] =>
  browse?.viewports?.length ? browse.viewports : DEFAULT_VIEWPORTS;
