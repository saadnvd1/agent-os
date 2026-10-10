/**
 * The one reader of a project's config: `agentos.json`, else `.dispatch.json`,
 * else the legacy `.agent-os/worktrees.json` / `.agent-os.json`. The first
 * file that exists is the config; a broken one is an error, never a reason
 * to read the next. Design: docs/decisions/2026-10-10-agentos-json.md.
 */

import * as fs from "fs";
import * as path from "path";
import type { z } from "zod";
import {
  agentosJson,
  dispatchJson,
  legacyJson,
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
}

const NONE: LoadedConfig = { config: {}, source: null, error: null };

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

function parse(file: string, text: string): LoadedConfig {
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
    const got = agentosJson.safeParse(raw);
    return got.success
      ? { config: got.data, source: file, error: null }
      : { ...NONE, source: file, error: describe(file, got.error) };
  }
  if (file === ".dispatch.json") {
    const got = dispatchJson.safeParse(raw);
    if (!got.success)
      return { ...NONE, source: file, error: describe(file, got.error) };
    const { workspace, ...config } = got.data;
    if (workspace && !config.cards?.workspace)
      config.cards = { ...config.cards, workspace };
    return { config, source: file, error: null };
  }
  const got = legacyJson.safeParse(raw);
  return got.success
    ? { config: fromLegacy(got.data), source: file, error: null }
    : { ...NONE, source: file, error: describe(file, got.error) };
}

// Keyed on the project; reused while the file's mtime and size hold, since
// agentEnv reads it for every terminal and chat start.
const cache = new Map<string, { stamp: string; loaded: LoadedConfig }>();

export function loadProjectConfig(projectPath: string): LoadedConfig {
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
    let text: string;
    try {
      text = fs.readFileSync(full, "utf-8");
    } catch (e) {
      return {
        ...NONE,
        source: file,
        error: `${file} could not be read: ${(e as Error).message}`,
      };
    }
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
