/**
 * Run the relay:
 *   RELAY_HOST=relay.runagentos.com MACHINE_DOMAIN=on.runagentos.com \
 *   RELAY_TLS_KEY=... RELAY_TLS_CERT=... RELAY_KEYS_FILE=keys.json \
 *   PORT=443 npx tsx relay/index.ts
 *
 * RELAY_KEYS_FILE maps machine id → public key PEM. It is the stand-in for
 * the control plane's key lookup until that exists.
 */

import fs from "fs";
import { createRelay, type KeyStore } from "./relay";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};

const fileKeys = (path: string): KeyStore => ({
  async publicKey(id) {
    try {
      const keys = JSON.parse(fs.readFileSync(path, "utf8")) as Record<
        string,
        string
      >;
      return keys[id] ?? null;
    } catch {
      return null;
    }
  },
});

const { server } = createRelay({
  relayHost: env("RELAY_HOST"),
  machineDomain: env("MACHINE_DOMAIN"),
  tls: {
    key: fs.readFileSync(env("RELAY_TLS_KEY"), "utf8"),
    cert: fs.readFileSync(env("RELAY_TLS_CERT"), "utf8"),
  },
  keys: fileKeys(env("RELAY_KEYS_FILE")),
  log: (line) => console.log(`${new Date().toISOString()} ${line}`),
});

const port = Number(process.env.PORT || 443);
server.listen(port, () => console.log(`relay listening on :${port}`));
