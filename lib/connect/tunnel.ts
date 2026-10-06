/**
 * This machine's end of the tunnel: dial the relay, prove who we are, and
 * hand each incoming stream to `onStream`. Reconnects with backoff forever.
 */

import WebSocket from "ws";
import { encode, Frame, json } from "./frames";
import { signHello } from "./identity";
import { Mux } from "./mux";
import type { TunnelStream } from "./stream";
import type { ConnectConfig } from "./config";

export interface TunnelOptions {
  config: ConnectConfig;
  machineKey: string;
  onStream: (stream: TunnelStream) => void;
  log?: (line: string) => void;
}

export type TunnelState = "connecting" | "up" | "denied" | "stopped";

export function startTunnel(opts: TunnelOptions) {
  const log = opts.log ?? (() => {});
  let state: TunnelState = "connecting";
  let ws: WebSocket | null = null;
  let delay = 1000;
  let timer: NodeJS.Timeout | null = null;

  const connect = () => {
    if (state === "stopped") return;
    const { relayUrl, relayServername, relayCa } = opts.config;
    // ws hands these to tls.connect; servername isn't in its own types.
    const tlsOptions = {
      // Frames are at most 64 KB; nothing legitimate comes near this.
      maxPayload: 1 << 20,
      servername: relayServername,
      ca: relayCa,
      headers: relayServername ? { Host: relayServername } : undefined,
    } as WebSocket.ClientOptions;
    ws = new WebSocket(`${relayUrl}/tunnel`, tlsOptions);
    const mux = new Mux(ws, (stream) => opts.onStream(stream));
    ws.on("open", () => {
      ws!.send(
        encode(
          Frame.HELLO,
          0,
          signHello(opts.config.machineId, opts.machineKey)
        )
      );
    });
    ws.on("message", (data: Buffer) => {
      const f = mux.handle(data);
      if (f?.type === Frame.READY) {
        state = "up";
        delay = 1000;
        log(
          `connect: up as ${json<{ hostname: string }>(f.payload)?.hostname}`
        );
      } else if (f?.type === Frame.DENIED) {
        state = "denied";
        log(
          `connect: relay refused: ${json<{ error: string }>(f.payload)?.error}`
        );
      }
    });
    ws.on("close", () => {
      mux.closeAll();
      if (state === "stopped") return;
      // A refusal won't fix itself quickly; back off hard.
      const denied = state === "denied";
      if (!denied) state = "connecting";
      const wait = denied ? 5 * 60_000 : delay;
      delay = Math.min(delay * 2, 30_000);
      timer = setTimeout(() => {
        state = "connecting";
        connect();
      }, wait);
    });
    ws.on("error", (err) => log(`connect: ${err.message}`));
  };

  connect();
  return {
    state: () => state,
    stop() {
      state = "stopped";
      if (timer) clearTimeout(timer);
      ws?.close();
    },
  };
}
