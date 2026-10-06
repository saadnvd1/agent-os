import { describe, it, expect } from "vitest";
import net from "net";
import tls from "tls";
import { parseSni } from "./sni";

// Capture a real ClientHello from Node's TLS stack.
function clientHello(servername?: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      sock.once("data", (d) => {
        resolve(d);
        sock.destroy();
        server.close();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      const c = tls.connect({
        host: "127.0.0.1",
        port,
        servername,
        rejectUnauthorized: false,
      });
      c.on("error", () => {});
    });
  });
}

describe("parseSni", () => {
  it("reads the server name from a real ClientHello", async () => {
    expect(parseSni(await clientHello("K7Q2.On.Test"))).toEqual({
      status: "ok",
      servername: "k7q2.on.test",
    });
  });

  it("asks for more bytes on a partial hello", async () => {
    const hello = await clientHello("a.on.test");
    expect(parseSni(hello.subarray(0, 40))).toEqual({ status: "more" });
  });

  it("refuses something that isn't TLS", () => {
    expect(parseSni(Buffer.from("GET / HTTP/1.1\r\n\r\n"))).toEqual({
      status: "invalid",
    });
  });
});
