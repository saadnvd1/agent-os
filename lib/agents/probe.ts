/**
 * Is each agent CLI installed on this machine, which version, and can it
 * run a prompt without someone signing in first? Read from the CLI's
 * version and its own credential files, never by logging in or spending.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  getAllProviderDefinitions,
  type ProviderId,
} from "../providers/registry";
import { pathFor, resolveCli } from "./cli-path";

const run = promisify(execFile);
const PROBE_MS = 15_000;
const CACHE_MS = 5 * 60 * 1000;

export type AgentAuth = "ready" | "needs-login" | "unknown";

export interface AgentProbe {
  installed: boolean;
  version?: string;
  auth: AgentAuth;
  // What to do about it, when something's missing.
  hint?: string;
}

const home = (...p: string[]) => path.join(os.homedir(), ...p);

function hasJsonKeys(file: string, key?: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<
      string,
      unknown
    >;
    return key ? !!data[key] : Object.keys(data).length > 0;
  } catch {
    return false;
  }
}

const anyEnv = (env: NodeJS.ProcessEnv, names: string[]) =>
  names.some((n) => !!env[n]?.trim());

// API keys Pi (and the CLIs built like it) read from the environment.
const PROVIDER_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "CEREBRAS_API_KEY",
];

type AuthCheck = (
  cli: string,
  env: NodeJS.ProcessEnv
) => Promise<AgentAuth> | AgentAuth;

const AUTH: Partial<Record<ProviderId, { check: AuthCheck; hint: string }>> = {
  codex: {
    // Exits 0 signed in, 1 not.
    check: async (cli, env) => {
      try {
        await run(cli, ["login", "status"], { timeout: PROBE_MS, env });
        return "ready";
      } catch (error) {
        return (error as { code?: unknown }).code === 1
          ? "needs-login"
          : "unknown";
      }
    },
    hint: "Run `codex login` in a terminal",
  },
  // OpenCode's own free models need no sign-in.
  opencode: { check: () => "ready", hint: "" },
  pi: {
    check: (_cli, env) =>
      hasJsonKeys(home(".pi", "agent", "auth.json")) ||
      anyEnv(env, PROVIDER_KEYS)
        ? "ready"
        : "needs-login",
    hint: "Run `pi` in a terminal and use /login, or set a provider API key",
  },
  gemini: {
    check: (_cli, env) =>
      fs.existsSync(home(".gemini", "oauth_creds.json")) ||
      anyEnv(env, ["GEMINI_API_KEY", "GOOGLE_API_KEY"])
        ? "ready"
        : "needs-login",
    hint: "Run `gemini` in a terminal to sign in, or set GEMINI_API_KEY",
  },
  cursor: {
    check: (_cli, env) =>
      hasJsonKeys(home(".cursor", "cli-config.json"), "authInfo") ||
      anyEnv(env, ["CURSOR_API_KEY"])
        ? "ready"
        : "needs-login",
    hint: "Run `cursor-agent login` in a terminal",
  },
  amp: {
    check: (_cli, env) =>
      hasJsonKeys(home(".local", "share", "amp", "secrets.json")) ||
      anyEnv(env, ["AMP_API_KEY"])
        ? "ready"
        : "needs-login",
    hint: "Run `amp login` in a terminal",
  },
};

export function parseVersion(text: string): string | undefined {
  return text.match(/\d+\.\d+(?:\.\d+)?(?:[-+.][\w.]+)?/)?.[0];
}

export async function probeAgent(
  id: ProviderId,
  cliName: string
): Promise<AgentProbe> {
  if (!cliName) return { installed: true, auth: "ready" };
  const cli = resolveCli(cliName, true);
  if (!cli)
    return { installed: false, auth: "unknown", hint: `Install ${cliName}` };
  const env = { ...process.env, PATH: pathFor(cli) };
  let version: string | undefined;
  try {
    const { stdout, stderr } = await run(cli, ["--version"], {
      timeout: PROBE_MS,
      env,
    });
    version = parseVersion(`${stdout}\n${stderr}`);
  } catch (error) {
    // Slow to answer is still installed; failing to run is a broken install.
    if (!(error as { killed?: boolean }).killed)
      return {
        installed: false,
        auth: "unknown",
        hint: `${cliName} is installed but doesn't run; reinstall it`,
      };
  }
  const auth = AUTH[id];
  const state = auth ? await auth.check(cli, env) : "unknown";
  return {
    installed: true,
    version,
    auth: state,
    hint: state === "needs-login" ? auth?.hint : undefined,
  };
}

let cache: { at: number; probes: Promise<Record<string, AgentProbe>> } | null =
  null;

// Every agent at once, at most every few minutes.
export function probeAgents(
  fresh = false
): Promise<Record<string, AgentProbe>> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.probes;
  const probes = Promise.all(
    getAllProviderDefinitions().map(
      async (d) => [d.id, await probeAgent(d.id, d.cli)] as const
    )
  ).then(Object.fromEntries);
  cache = { at: Date.now(), probes };
  return probes;
}
