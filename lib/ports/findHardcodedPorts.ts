import fs from "fs";
import path from "path";
import type { HardcodedPort } from "./types";

const SCRIPTS = ["dev", "start", "serve", "develop"];
const VITE_CONFIGS = ["ts", "mts", "js", "mjs", "cjs"].map(
  (ext) => `vite.config.${ext}`
);

const FLAG = /(^|\s)(-p|--port)(=|\s+)(\d{2,5})(?=\s|$)/;
const ENV = /(^|\s)PORT=(\d{2,5})(?=\s)/;
const SHELL_OPS = /&&|\|\||[;|&<>`]|\$\(/;

// A literal port in a command, and the command with `port` in its place.
export function literalPort(
  command: string,
  port: number
): { port: number; replaced: string } | null {
  const flag = FLAG.exec(command);
  if (flag)
    return {
      port: Number(flag[4]),
      replaced: command.replace(FLAG, `$1$2$3${port}`),
    };
  const env = ENV.exec(command);
  if (env)
    return {
      port: Number(env[2]),
      replaced: command.replace(ENV, `$1PORT=${port}`),
    };
  return null;
}

// An npm script runs with node_modules/.bin on PATH; a shell doesn't.
function runnable(script: string): string | null {
  if (SHELL_OPS.test(script)) return null;
  const words = script.trim().split(/\s+/);
  const envs: string[] = [];
  while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0]))
    envs.push(words.shift()!);
  if (!words.length) return null;
  return [...envs, "npx", ...words].join(" ");
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/**
 * The ports a project fixes for itself instead of taking the session's:
 * a literal `-p`/`--port`/`PORT=` in its package.json server scripts or
 * agentos.json `dev`, and `server.port` in a Vite config. Each comes with
 * the command to run on `port` instead, when there is one.
 */
export function findHardcodedPorts(
  projectDir: string,
  dev: string | undefined,
  port: number
): HardcodedPort[] {
  const found: HardcodedPort[] = [];
  const pkg = readJson(path.join(projectDir, "package.json")) as {
    scripts?: Record<string, unknown>;
  } | null;
  const scripts = pkg?.scripts ?? {};
  for (const name of SCRIPTS) {
    const script = scripts[name];
    if (typeof script !== "string") continue;
    const hit = literalPort(script, port);
    if (hit && hit.port !== port)
      found.push({
        where: `npm run ${name}`,
        port: hit.port,
        fix: runnable(hit.replaced),
      });
  }
  if (dev) {
    const hit = literalPort(dev, port);
    if (hit && hit.port !== port)
      found.push({
        where: "agentos.json dev",
        port: hit.port,
        fix: hit.replaced,
      });
  }
  const usesVite = SCRIPTS.some(
    (n) =>
      typeof scripts[n] === "string" && /\bvite\b/.test(scripts[n] as string)
  );
  for (const file of VITE_CONFIGS) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(projectDir, file), "utf8");
    } catch {
      continue;
    }
    const m = /\bport\s*:\s*(\d{2,5})\b/.exec(text);
    if (m && Number(m[1]) !== port)
      found.push({
        where: file,
        port: Number(m[1]),
        fix: usesVite ? `npx vite --port ${port} --strictPort` : null,
      });
    break;
  }
  return found;
}

export function hardcodedNote(h: HardcodedPort): string {
  return h.fix
    ? `\`${h.where}\` hardcodes port ${h.port}: run \`${h.fix}\` instead.`
    : `\`${h.where}\` hardcodes port ${h.port}: start it on your own port instead.`;
}
