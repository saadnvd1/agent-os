/** Test-only: the smallest relay — checks HELLO, opens a stream per TCP connection on `front`. */

import net, { type AddressInfo } from "net";
import { WebSocketServer } from "ws";
import { NonceCache, verifyHello, type Hello } from "./identity";
import { Mux } from "./mux";
import { encode, Frame, json } from "./frames";

export async function testRelay(publicKey: string) {
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise((r) => wss.once("listening", r));
  let mux: Mux | null = null;
  wss.on("connection", (ws) => {
    const m = new Mux(ws);
    ws.on("message", (d: Buffer) => {
      const f = m.handle(d);
      if (f?.type !== Frame.HELLO) return;
      if (!verifyHello(json<Hello>(f.payload), publicKey, new NonceCache()).ok)
        return ws.close();
      mux = m;
      ws.send(encode(Frame.READY, 0, {}));
    });
    ws.on("close", () => {
      if (mux === m) mux = null;
    });
  });
  const front = net.createServer((sock) => {
    const s = mux?.open({ remote: sock.remoteAddress });
    if (!s) return sock.destroy();
    sock.pipe(s).pipe(sock);
    sock.on("close", () => s.destroy());
    s.on("close", () => sock.destroy());
  });
  await new Promise<void>((r) => front.listen(0, "127.0.0.1", r));
  return {
    url: `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`,
    frontPort: (front.address() as AddressInfo).port,
    connected: () => mux !== null,
    close: () => {
      wss.close();
      front.close();
    },
  };
}
