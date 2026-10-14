import fs from "fs";
import os from "os";
import path from "path";
import type { ShareContext } from "./redact";

// Environment variables that hold a credential, by name.
const SECRET_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASS|PWD|CREDENTIALS?|AUTH)/;
const NOT_SECRET_NAME = /(SOCK|_FILE|_PATH|_DIR)$/;
const USERINFO_URL = /^[a-z][a-z0-9+.-]*:\/\/[^@\s/]+@/i;

export function envSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.length < 8) continue;
    const named = SECRET_NAME.test(name) && !NOT_SECRET_NAME.test(name);
    if (named || (name.endsWith("_URL") && USERINFO_URL.test(value)))
      out.add(value);
  }
  return [...out];
}

/** Host and HostName entries of an ssh config, wildcards left out. */
export function sshHosts(config: string): string[] {
  const out = new Set<string>();
  for (const line of config.split("\n")) {
    const m = line.match(/^\s*(?:Host|HostName)\s+(.+?)\s*$/i);
    if (!m) continue;
    for (const h of m[1].split(/\s+/))
      if (!/[*?!]/.test(h) && !/^\d+\.\d+\.\d+\.\d+$/.test(h)) out.add(h);
  }
  return [...out];
}

/** This machine's details, read once per request. Every read fails soft. */
export function shareContext(): ShareContext {
  const home = os.homedir();
  let user = "";
  try {
    user = os.userInfo().username;
  } catch {
    user = process.env.USER ?? "";
  }
  const hostname = os.hostname();
  let ssh = "";
  try {
    ssh = fs.readFileSync(path.join(home, ".ssh", "config"), "utf8");
  } catch {}
  const hosts = [hostname, hostname.split(".")[0], ...sshHosts(ssh)];
  return { home, user, secrets: envSecrets(), hosts };
}
