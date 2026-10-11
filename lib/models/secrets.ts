/**
 * A provider's key, fetched from where its reference points at the moment
 * an agent launches, and handed straight to that agent's environment. It is
 * never written anywhere: not the database, not a log, not a prompt. Every
 * key fetched is remembered in memory only so redact() can scrub it from
 * any text on its way to a log or an error.
 */

import { execFile } from "child_process";
import { shellQuote } from "../hosts/ssh";
import type { SecretRef } from "./providers";

export type SecretCommand = (cmd: string, args: string[]) => Promise<string>;

const run: SecretCommand = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 15_000 }, (err, stdout) =>
      // Its stderr isn't passed on: a tool may echo what it was asked.
      err ? reject(new Error(`${cmd} failed`)) : resolve(stdout)
    )
  );

// An environment variable a key may be read from: one named for an API key,
// never AgentOS's own nor its Claude login's, so a reference can't lift an
// unrelated secret out of the server's environment.
export const KEY_ENV_NAME =
  /^(?!(?:ANTHROPIC|CLAUDE|AGENTOS)_)[A-Z][A-Z0-9_]*_API_KEY$/;

// The command that prints the key, as argv; null for an environment
// variable, which is read directly.
export function secretCommand(ref: SecretRef): string[] | null {
  if (ref.kind === "tokenvault")
    return ["tv", "get", ref.project, ...(ref.desc ? [ref.desc] : [])];
  if (ref.kind === "keychain")
    return [
      "security",
      "find-generic-password",
      "-s",
      ref.service,
      ...(ref.account ? ["-a", ref.account] : []),
      "-w",
    ];
  return null;
}

// The same, as shell text that expands to the key inside the agent's own
// shell (a terminal launch), so AgentOS never holds it at all.
export function secretShellExpansion(ref: SecretRef): string {
  const argv = secretCommand(ref);
  if (!argv) return `"\${${ref.kind === "env" ? envName(ref.name) : ""}}"`;
  return `"$(${argv.map(shellQuote).join(" ")})"`;
}

function envName(name: string): string {
  if (!KEY_ENV_NAME.test(name))
    throw new Error(
      `A key can't be read from ${name}: name a *_API_KEY variable`
    );
  return name;
}

const seen = new Set<string>();

export async function resolveSecret(
  ref: SecretRef,
  exec: SecretCommand = run
): Promise<string> {
  const argv = secretCommand(ref);
  let value: string | undefined;
  if (argv) {
    const out = await exec(argv[0], argv.slice(1)).catch(() => {
      throw new Error(`Couldn't read the key (${argv[0]} failed)`);
    });
    value = out.trim();
  } else if (ref.kind === "env") value = process.env[envName(ref.name)]?.trim();
  if (!value) throw new Error("The key reference resolved to nothing");
  if (value.length >= 8) seen.add(value);
  return value;
}

// Scrubs every key fetched so far out of the text.
export function redact(text: string): string {
  let out = text;
  for (const s of seen) out = out.split(s).join("[redacted]");
  return out;
}
