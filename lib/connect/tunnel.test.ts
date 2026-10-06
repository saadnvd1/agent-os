import { describe, it, expect, afterAll } from "vitest";
import https from "https";
import net, { type AddressInfo } from "net";
import { WebSocketServer } from "ws";
import {
  generateMachineKey,
  NonceCache,
  verifyHello,
  type Hello,
} from "./identity";
import { Mux } from "./mux";
import { encode, Frame, json } from "./frames";
import { startTunnel } from "./tunnel";
import { makeTestPki } from "./test-pki";

// The machine side against the smallest possible relay: one WebSocket that
// checks HELLO, then opens a stream per TCP connection on `front`.
describe("tunnel client", () => {
  const cleanup: (() => void)[] = [];
  afterAll(() => cleanup.forEach((f) => f()));

  it("serves HTTPS through the tunnel with a key only the machine holds", async () => {
    const pki = makeTestPki();
    const machine = generateMachineKey();
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((r) => wss.once("listening", r));
    let mux: Mux | null = null;
    wss.on("connection", (ws) => {
      const m = new Mux(ws);
      ws.on("message", (d: Buffer) => {
        const f = m.handle(d);
        if (f?.type !== Frame.HELLO) return;
        const ok = verifyHello(
          json<Hello>(f.payload),
          machine.publicKey,
          new NonceCache()
        );
        if (!ok.ok) return ws.close();
        mux = m;
        ws.send(encode(Frame.READY, 0, { hostname: "m1.on.test" }));
      });
    });
    const front = net.createServer((sock) => {
      const s = mux!.open({ remote: sock.remoteAddress })!;
      sock.pipe(s).pipe(sock);
      sock.on("close", () => s.destroy());
    });
    await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));

    const app = https.createServer(pki.leaf("m1.on.test"), (_req, res) =>
      res.end("from the machine")
    );
    const tunnel = startTunnel({
      config: {
        machineId: "m1",
        hostname: "m1.on.test",
        relayUrl: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`,
      },
      machineKey: machine.privateKey,
      onStream: (s) => app.emit("connection", s),
    });
    cleanup.push(
      tunnel.stop,
      () => wss.close(),
      () => front.close()
    );
    for (let i = 0; i < 100 && tunnel.state() !== "up"; i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(tunnel.state()).toBe("up");

    const body = await new Promise<string>((resolve, reject) => {
      https
        .get(
          {
            host: "127.0.0.1",
            port: (front.address() as AddressInfo).port,
            path: "/",
            servername: "m1.on.test",
            ca: pki.ca,
          },
          (res) => {
            let b = "";
            res.on("data", (c) => (b += c));
            res.on("end", () => resolve(b));
          }
        )
        .on("error", reject);
    });
    expect(body).toBe("from the machine");
  }, 30_000);
});
