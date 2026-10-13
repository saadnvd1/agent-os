/**
 * Linking this machine to the Connect service with a code from
 * runagentos.com. Shared by `agent-os connect` and the setup's link form.
 */

import { type ConnectConfig } from "./config";
import { DEFAULT_API, checkApiUrl, registerWithCode } from "./control-api";
import { enrol } from "./enrol";

/** The code as typed, or null when it can't be one. */
export function cleanLinkCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  if (!code || code.length > 128 || /[\s\u0000-\u001f\u007f-\u009f]/.test(code))
    return null;
  return code;
}

export async function linkWithCode(opts: {
  code: string;
  name: string;
  port: number;
  dir?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ConnectConfig> {
  const env = opts.env ?? process.env;
  const apiUrl = checkApiUrl(
    env.CONNECT_API_URL || DEFAULT_API,
    env.AGENTOS_CONNECT_OPERATOR === "1"
  );
  return enrol({
    dir: opts.dir,
    register: registerWithCode(apiUrl, opts.code, opts.name, opts.port),
  });
}
