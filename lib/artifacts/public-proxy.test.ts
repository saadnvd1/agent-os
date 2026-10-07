import net from "net";
import { describe, expect, it } from "vitest";
import {
  isLocalAddress,
  publicAddresses,
  startPublicProxy,
} from "./public-proxy";

// A SOCKS5 request through the proxy: resolves the reply's code, or the
// method byte when the greeting is refused.
function socks(
  proxyPort: number,
  address: Buffer,
  port: number,
  { command = 1, methods = [0] } = {}
) {
  return new Promise<number>((resolve, reject) => {
    const s = net.connect(proxyPort, "127.0.0.1");
    let greeted = false;
    s.on("data", (d) => {
      if (!greeted && d[1] === 0) {
        greeted = true;
        s.write(
          Buffer.concat([
            Buffer.from([5, command, 0]),
            address,
            Buffer.from([port >> 8, port & 0xff]),
          ])
        );
      } else {
        resolve(d[1]);
        s.destroy();
      }
    });
    s.on("error", reject);
    s.write(Buffer.from([5, methods.length, ...methods]));
  });
}

const byName = (host: string) =>
  Buffer.concat([Buffer.from([3, host.length]), Buffer.from(host)]);
const ipv4 = (a: string) => Buffer.from([1, ...a.split(".").map(Number)]);
const ipv6Loopback = Buffer.from([4, ...Array(15).fill(0), 1]);

const connectThrough = (proxyPort: number, host: string, port: number) =>
  socks(proxyPort, byName(host), port);

describe("the preview's proxy", () => {
  it("counts loopback, private, link-local, CGNAT and mapped addresses as local", () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::ffff:127.0.0.1",
      "fd7a:115c:a1e0::1",
      "fe80::1",
      "not an ip",
    ])
      expect(isLocalAddress(a), a).toBe(true);
    for (const a of ["151.101.1.229", "2a04:4e42::485", "1.1.1.1"])
      expect(isLocalAddress(a), a).toBe(false);
  });

  it("refuses a name that resolves locally", async () => {
    expect(await publicAddresses("localhost")).toBeNull();
    expect(await publicAddresses("127.0.0.1")).toBeNull();
    expect(await publicAddresses("[::1]")).toBeNull();
  });

  it("refuses to connect to this machine", async () => {
    const proxy = await startPublicProxy();
    const target = net.createServer().listen(0, "127.0.0.1");
    await new Promise((r) => target.once("listening", r));
    const port = (target.address() as net.AddressInfo).port;
    try {
      expect(await connectThrough(proxy.port, "127.0.0.1", port)).toBe(2);
      expect(await connectThrough(proxy.port, "localhost", port)).toBe(2);
      expect(await socks(proxy.port, ipv4("127.0.0.1"), port)).toBe(2);
      expect(await socks(proxy.port, ipv4("192.168.1.1"), 80)).toBe(2);
      expect(await socks(proxy.port, ipv6Loopback, port)).toBe(2);
    } finally {
      target.close();
      await proxy.close();
    }
  });

  it("refuses anything but CONNECT, and clients that want authentication", async () => {
    const proxy = await startPublicProxy();
    try {
      // BIND and UDP ASSOCIATE.
      expect(await socks(proxy.port, ipv4("1.1.1.1"), 80, { command: 2 })).toBe(
        7
      );
      expect(await socks(proxy.port, ipv4("1.1.1.1"), 80, { command: 3 })).toBe(
        7
      );
      // Username/password only: no acceptable method.
      expect(
        await socks(proxy.port, ipv4("1.1.1.1"), 80, { methods: [2] })
      ).toBe(0xff);
    } finally {
      await proxy.close();
    }
  });
});
