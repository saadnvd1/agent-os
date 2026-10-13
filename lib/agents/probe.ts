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
// Short, so installing or signing in shows up within a minute.
const CACHE_MS = 60 * 1000;

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

// Claude Code keeps who is signed in under `oauthAccount` in its config, at
// $CLAUDE_CONFIG_DIR/.claude.json, or ~/.claude.json without that variable.
function claudeAuth(env: NodeJS.ProcessEnv): AgentAuth {
  const dir = env.CLAUDE_CONFIG_DIR?.trim();
  const configDir = dir || home(".claude");
  const config = dir ? path.join(dir, ".claude.json") : home(".claude.json");
  if (
    anyEnv(env, [
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
    ]) ||
    hasJsonKeys(path.join(configDir, "settings.json"), "apiKeyHelper")
  )
    return "ready";
  if (hasJsonKeys(config, "oauthAccount")) return "ready";
  // A config without an account is a CLI that has never signed in; no config
  // at all tells nothing.
  return hasJsonKeys(config) ? "needs-login" : "unknown";
}

// Signed in when `cli args` exits 0. Timing out or failing to start tells
// nothing; any other exit code is the CLI saying it isn't signed in.
async function exitAuth(
  cli: string,
  env: NodeJS.ProcessEnv,
  args: string[],
  signedOut: (code: unknown) => boolean
): Promise<AgentAuth> {
  try {
    await run(cli, args, { timeout: PROBE_MS, env });
    return "ready";
  } catch (error) {
    return signedOut((error as { code?: unknown }).code)
      ? "needs-login"
      : "unknown";
  }
}

// Kiro's `whoami` is never read, only its exit code: its output names the
// account.
const kiroAuth: AuthCheck = (cli, env) =>
  anyEnv(env, ["KIRO_API_KEY"])
    ? "ready"
    : exitAuth(cli, env, ["whoami"], (c) => typeof c === "number" && c !== 0);

const AUTH: Partial<Record<ProviderId, { check: AuthCheck; hint: string }>> = {
  claude: {
    check: (_cli, env) => claudeAuth(env),
    hint: "Run `claude auth login` in a terminal",
  },
  codex: {
    // Exits 0 signed in, 1 not.
    check: (cli, env) =>
      exitAuth(cli, env, ["login", "status"], (c) => c === 1),
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
  // The CLI also signs in through the GitHub CLI's login, which no file of
  // its own shows: without a trace of a sign-in, it's not known to need one.
  copilot: {
    check: (_cli, env) => {
      if (anyEnv(env, ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"]))
        return "ready";
      try {
        const config = fs.readFileSync(
          path.join(
            env.COPILOT_HOME?.trim() || home(".copilot"),
            "config.json"
          ),
          "utf8"
        );
        return /logged.?in.?user/i.test(config) ? "ready" : "unknown";
      } catch {
        return "unknown";
      }
    },
    hint: "Run `copilot login` in a terminal",
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
  kiro: {
    check: kiroAuth,
    hint: "Run `kiro-cli login --use-device-flow` in a terminal, or set KIRO_API_KEY",
  },
  amazonq: {
    check: (cli, env) =>
      exitAuth(cli, env, ["whoami"], (c) => typeof c === "number" && c !== 0),
    hint: "Run `q login --use-device-flow` in a terminal",
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

// Every agent at once, at most once a minute.
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
