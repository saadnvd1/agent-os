/**
 * A SOCKS5 proxy on loopback that only connects to public addresses. The
 * preview browser sends every connection through it, so a page can load a
 * CDN library but never reach this machine, its LAN or the tailnet. It
 * carries bytes only, so HTTP, TLS and WebSockets pass through unchanged.
 */

import dns from "dns/promises";
import net from "net";
import os from "os";

const LOCAL = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  LOCAL.addSubnet(network, prefix, "ipv4");
// IPv6 ranges that carry an IPv4 address a translator may route to. (IPv4-
// mapped addresses already match the IPv4 entries above.)
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2001::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  LOCAL.addSubnet(network, prefix, "ipv6");

function ownAddresses(): net.BlockList {
  const own = new net.BlockList();
  for (const entry of Object.values(os.networkInterfaces()).flat())
    if (entry)
      own.addAddress(entry.address, entry.family === "IPv6" ? "ipv6" : "ipv4");
  return own;
}

export function isLocalAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  const type = family === 6 ? "ipv6" : "ipv4";
  return LOCAL.check(address, type) || ownAddresses().check(address, type);
}

type Resolved = { address: string; family: number }[];

// Every address a host resolves to, or null when any is local. The caller
// connects only to these, so a name that re-resolves (DNS rebinding) can't
// redirect it.
export async function publicAddresses(host: string): Promise<Resolved | null> {
  const literal = net.isIP(host.replace(/^\[|\]$/g, ""));
  const addresses: Resolved = literal
    ? [{ address: host.replace(/^\[|\]$/g, ""), family: literal }]
    : await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0) return null;
  return addresses.some((a) => isLocalAddress(a.address)) ? null : addresses;
}

// SOCKS5 replies: 0 ok, 2 refused by rule, 7 command unsupported.
const reply = (code: number) => Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0]);

function readRequest(data: Buffer) {
  if (data.length < 5) return "short" as const;
  if (data[0] !== 5 || data[2] !== 0) return null;
  const type = data[3];
  const end = type === 1 ? 10 : type === 3 ? 7 + data[4] : type === 4 ? 22 : -1;
  if (end === -1) return null;
  if (data.length < end) return "short" as const;
  const host =
    type === 1
      ? [...data.subarray(4, 8)].join(".")
      : type === 3
        ? data.subarray(5, 5 + data[4]).toString("latin1")
        : Array.from({ length: 8 }, (_, i) =>
            data.readUInt16BE(4 + i * 2).toString(16)
          ).join(":");
  return {
    command: data[1],
    host,
    port: data.readUInt16BE(end - 2),
    rest: data.subarray(end),
  };
}

const MAX_EARLY_BYTES = 64 * 1024;

export interface PublicProxy {
  port: number;
  close(): Promise<void>;
}

export function startPublicProxy(): Promise<PublicProxy> {
  const sockets = new Set<net.Socket>();
  const track = (s: net.Socket) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => s.destroy());
    return s;
  };
  const server = net.createServer((client) => {
    track(client);
    let data = Buffer.alloc(0);
    let greeted = false;
    const onData = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      if (!greeted) {
        if (data.length < 2 || data.length < 2 + data[1]) return;
        if (data[0] !== 5 || !data.subarray(2, 2 + data[1]).includes(0))
          return void client.end(Buffer.from([5, 0xff]));
        data = data.subarray(2 + data[1]);
        greeted = true;
        client.write(Buffer.from([5, 0]));
      }
      const request = readRequest(data);
      if (request === "short") return;
      client.off("data", onData);
      if (!request || request.command !== 1 || request.port === 0)
        return void client.end(reply(7), () => client.destroy());
      const early: Buffer[] = [request.rest];
      let earlyBytes = request.rest.length;
      const hold = (chunk: Buffer) => {
        earlyBytes += chunk.length;
        if (earlyBytes > MAX_EARLY_BYTES) return void client.destroy();
        early.push(chunk);
      };
      client.on("data", hold);
      void publicAddresses(request.host).then((addresses) => {
        if (client.destroyed) return;
        client.off("data", hold);
        if (!addresses)
          return void client.end(reply(2), () => client.destroy());
        client.pause();
        const upstream = track(
          net.connect({
            // A name goes through `lookup`, which hands back only the checked
            // addresses, so every family is tried.
            host: request.host,
            port: request.port,
            autoSelectFamily: true,
            lookup: (_h, opts, cb) =>
              opts.all
                ? cb(null, addresses)
                : cb(null, addresses[0].address, addresses[0].family),
          })
        );
        upstream.once("connect", () => {
          client.write(reply(0));
          for (const chunk of early) upstream.write(chunk);
          upstream.pipe(client);
          client.pipe(upstream);
          client.resume();
        });
        upstream.on("close", () => client.destroy());
        client.on("close", () => upstream.destroy());
      });
    };
    client.on("data", onData);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      server.on("error", () => {});
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : 0,
        close: () =>
          new Promise((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
