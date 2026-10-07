import net from "net";
import { describe, expect, it } from "vitest";
import {
  isLocalAddress,
  publicAddresses,
  startPublicProxy,
} from "./public-proxy";

// A SOCKS5 CONNECT to host:port through the proxy; resolves the reply code.
function connectThrough(proxyPort: number, host: string, port: number) {
  return new Promise<number>((resolve, reject) => {
    const s = net.connect(proxyPort, "127.0.0.1");
    let stage = 0;
    s.on("data", (d) => {
      if (stage === 0) {
        stage = 1;
        const name = Buffer.from(host);
        const req = Buffer.concat([
          Buffer.from([5, 1, 0, 3, name.length]),
          name,
          Buffer.from([port >> 8, port & 0xff]),
        ]);
        s.write(req);
      } else {
        resolve(d[1]);
        s.destroy();
      }
    });
    s.on("error", reject);
    s.write(Buffer.from([5, 1, 0]));
  });
}

describe("the preview's proxy", () => {
  it("counts loopback, private, link-local, CGNAT and mapped addresses as local", () => {
    for (const a of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.73.93.113",
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
    } finally {
      target.close();
      await proxy.close();
    }
  });
});
