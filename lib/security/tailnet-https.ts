/**
 * HTTPS on the tailnet, so browsers allow what needs a secure origin
 * (WebAuthn for passkeys, clipboard, push). The certificate is Tailscale's
 * own for this machine's MagicDNS name (`tailscale cert`), renewed daily.
 *
 * It runs on its own port (AgentOS's + 432, so 3443) on the tailnet address
 * only. Loopback stays plain HTTP for bin/aos and the MCP tools, and the
 * tailnet's plain HTTP port keeps working for existing links. Each TLS
 * connection is a real socket, so trust still comes from its actual remote
 * address. AgentOS never runs `tailscale serve` or funnel.
 */

import { execFile } from "child_process";
import fs from "fs";
import https from "https";
import os from "os";
import path from "path";
import type { IncomingMessage, ServerResponse } from "http";
import type { Socket } from "net";
import type { Duplex } from "stream";
import { tailscaleBinary, tailscaleStatus } from "@/lib/tailscale";

export interface HttpsHandlers {
  onRequest: (req: IncomingMessage, res: ServerResponse) => void;
  onUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

const DAY = 24 * 60 * 60 * 1000;
export const tailnetHttpsPort = (port: number) =>
  Number(process.env.AGENTOS_TAILNET_HTTPS_PORT || port + 432);

const g = globalThis as unknown as { __agentosTailnetHttps?: string | null };
/** https://<name>.ts.net:<port> while it is being served, else null. */
export const tailnetHttpsUrl = () => g.__agentosTailnetHttps ?? null;

function runCert(bin: string, name: string, dir: string): Promise<boolean> {
  return new Promise((resolve) =>
    execFile(
      bin,
      [
        "cert",
        "--cert-file",
        path.join(dir, "tailnet.crt"),
        "--key-file",
        path.join(dir, "tailnet.key"),
        name,
      ],
      { timeout: 120_000 },
      (err) => resolve(!err)
    )
  );
}

/** Gets (or refreshes) the certificate; null when the tailnet can't issue one. */
export async function tailnetCert(
  dir = path.join(os.homedir(), ".agent-os", "tls")
) {
  const ts = await tailscaleStatus();
  const bin = tailscaleBinary();
  if (ts.state !== "running" || !ts.https || !ts.dnsName || !bin) return null;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!(await runCert(bin, ts.dnsName, dir))) return null;
  fs.chmodSync(path.join(dir, "tailnet.key"), 0o600);
  return {
    name: ts.dnsName,
    key: fs.readFileSync(path.join(dir, "tailnet.key"), "utf8"),
    cert: fs.readFileSync(path.join(dir, "tailnet.crt"), "utf8"),
  };
}

export function startTailnetHttps(opts: {
  handlers: HttpsHandlers;
  port: number;
  addresses: () => string[];
  log?: (line: string) => void;
  /** Where the certificate comes from; Tailscale unless a test says otherwise. */
  getCert?: () => Promise<{ key: string; cert: string; name: string } | null>;
}) {
  const log = opts.log ?? console.log;
  const port = tailnetHttpsPort(opts.port);
  const servers = new Map<
    string,
    { server: https.Server; sockets: Set<Socket> }
  >();
  let tls: { key: string; cert: string; name: string } | null = null;

  const listen = (address: string) => {
    if (!tls || servers.has(address)) return;
    const server = https.createServer(tls, opts.handlers.onRequest);
    server.on("upgrade", opts.handlers.onUpgrade);
    server.on("tlsClientError", () => {});
    const sockets = new Set<Socket>();
    server.on("connection", (s: Socket) => {
      sockets.add(s);
      s.once("close", () => sockets.delete(s));
    });
    server.on("error", (err) => {
      log(`> tailnet https on ${address}:${port}: ${err.message}`);
      close(address);
    });
    server.listen(port, address, () =>
      log(`> Agent-OS ready on https://${tls!.name}:${port} (${address})`)
    );
    servers.set(address, { server, sockets });
  };
  const close = (address: string) => {
    const s = servers.get(address);
    if (!s) return;
    s.server.close();
    s.sockets.forEach((x) => x.destroy());
    servers.delete(address);
  };
  const follow = () => {
    const want = opts.addresses();
    want.forEach(listen);
    for (const a of servers.keys()) if (!want.includes(a)) close(a);
    g.__agentosTailnetHttps =
      tls && servers.size ? `https://${tls.name}:${port}` : null;
  };
  const refresh = async () => {
    try {
      const next = await (opts.getCert ?? tailnetCert)();
      if (!next) return;
      const renewed = tls && tls.cert !== next.cert;
      tls = next;
      if (renewed)
        for (const { server } of servers.values())
          server.setSecureContext(next);
      follow();
    } catch (err) {
      log(`> tailnet https: ${(err as Error).message}`);
    }
  };

  const ready = refresh();
  const timers = [
    setInterval(() => void refresh(), DAY),
    // Tailnet addresses come and go; follow them like the plain listeners do.
    setInterval(follow, 5000),
  ];
  timers.forEach((t) => t.unref());
  return {
    url: tailnetHttpsUrl,
    ready,
    port,
    stop: () => {
      timers.forEach(clearInterval);
      [...servers.keys()].forEach(close);
      g.__agentosTailnetHttps = null;
    },
  };
}
