/**
 * Two AgentOS machines' rpc front ends for the peer tests: each with a
 * loopback listener and a tunnel listener, a fake Next behind the gate, and
 * an edge that routes https://<m- name>/… to the right tunnel.
 */

import http, { type IncomingMessage, type ServerResponse } from "http";
import { NextRequest } from "next/server";
import type { AddressInfo } from "net";
import type { FakeMachine } from "@/lib/__fixtures__/peer-machine";
import { tunnelListener } from "@/lib/connect/serve";
import { getDb } from "@/lib/db";
import { gateRequest, gateUpgrade } from "@/lib/security/gate";
import type { AuthPolicy } from "@/lib/security/auth";
import { recordPeerCall } from "@/lib/peer/audit";
import { peerSecret } from "@/lib/peer/internal";
import type { PeerPin } from "@/lib/peer/links";
import { createReplayGuard } from "@/lib/peer/replay";
import {
  createBodyBudget,
  handlePeerRpc,
  isPeerRpc,
  loopbackDispatch,
  type RpcDeps,
} from "@/lib/peer/rpc-server";

export interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

/** A real route handler, run behind the gate as Next would run it. */
export type Route = (req: NextRequest) => Response | Promise<Response>;

/** What Next would be: echoes how the gate saw the call, or runs `routes`. */
function fakeNext(seen: Seen[], routes: Record<string, Route>) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    let body = "";
    for await (const c of req) body += c;
    seen.push({
      method: req.method ?? "",
      url: req.url ?? "",
      headers: { ...req.headers },
      body,
    });
    const route = routes[(req.url ?? "").split("?")[0]];
    if (route) {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers))
        if (typeof v === "string") headers.set(k, v);
      const out = await route(
        new NextRequest(`http://127.0.0.1${req.url}`, {
          method: req.method,
          headers,
          body: body || undefined,
        })
      );
      res.statusCode = out.status;
      res.setHeader("Content-Type", out.headers.get("content-type") ?? "");
      return res.end(Buffer.from(await out.arrayBuffer()));
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Set-Cookie", "aos_device=leak");
    if (req.url?.startsWith("/api/tasks/t-9/merge")) {
      res.statusCode = 409;
      return res.end(JSON.stringify({ error: "not mergeable" }));
    }
    res.end(
      JSON.stringify({
        url: req.url,
        method: req.method,
        trust: req.headers["x-agentos-trust"],
        device: req.headers["x-agentos-device"],
        peer: req.headers["x-agentos-peer"],
        internal: req.headers["x-agentos-peer-internal"] ?? null,
        body: body ? JSON.parse(body) : null,
      })
    );
  };
}

export interface Machine {
  hostname: string;
  tunnelPort: number;
  seen: Seen[];
  deps: RpcDeps;
  close: () => Promise<void>;
}

const listen = (s: http.Server) =>
  new Promise<number>((r) =>
    s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port))
  );

/** One machine's AgentOS: its loopback listener and its tunnel listener. */
export async function machine(
  me: FakeMachine,
  pinFor: (machineId: string) => PeerPin | null,
  o: { routes?: Record<string, Route>; unlinked?: RpcDeps["unlinked"] } = {}
): Promise<Machine> {
  const seen: Seen[] = [];
  const policy: AuthPolicy = {
    tailnet: [],
    lookup: (t) => (t === "aosd_phone" ? { id: "phone" } : null),
    peerSecret,
  };
  const next = fakeNext(seen, o.routes ?? {});
  let internalPort = 0;
  const deps: RpcDeps = {
    identity: () => me,
    boxKey: () => me.box,
    pinForMachine: pinFor,
    unlinked: o.unlinked,
    anyActive: () => true,
    replay: createReplayGuard(),
    dispatch: (d: Parameters<ReturnType<typeof loopbackDispatch>>[0]) =>
      loopbackDispatch(internalPort)(d),
    audit: recordPeerCall,
    budget: createBodyBudget(),
  };
  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    if (!gateRequest(req, res, policy)) return;
    if (isPeerRpc(req)) return void handlePeerRpc(req, res, deps);
    void next(req, res);
  };
  const internal = http.createServer(onRequest);
  internalPort = await listen(internal);
  const tunnel = tunnelListener(() => me.hostname, {
    onRequest,
    onUpgrade: (req, socket) => {
      if (!gateUpgrade(req, socket, policy)) return;
      socket.end("HTTP/1.1 101 Switching Protocols\r\n\r\n");
    },
  });
  const tunnelPort = await listen(tunnel);
  return {
    hostname: me.hostname,
    tunnelPort,
    seen,
    deps,
    close: async () => {
      await new Promise((r) => internal.close(r));
      await new Promise((r) => tunnel.close(r));
    },
  };
}

/** What Cloudflare does: https://<m- name>/… to that machine's tunnel. */
export function edge(
  machines: Machine[],
  tamper?: (body: Buffer) => Buffer
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const m = machines.find((x) => x.hostname === url.hostname);
    if (url.protocol !== "https:" || !m) throw new Error("no such host");
    const body = init?.body ? Buffer.from(init.body as Uint8Array) : undefined;
    const { status, buf, headers } = await new Promise<{
      status: number;
      buf: Buffer;
      headers: Record<string, string>;
    }>((resolve, reject) => {
      const out = http.request(
        {
          host: "127.0.0.1",
          port: m.tunnelPort,
          method: init?.method ?? "GET",
          path: url.pathname + url.search,
          headers: {
            ...(init?.headers as Record<string, string>),
            host: url.hostname,
            ...(body && { "content-length": String(body.length) }),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              buf: Buffer.concat(chunks),
              headers: Object.fromEntries(
                Object.entries(res.headers).filter(
                  (e): e is [string, string] => typeof e[1] === "string"
                )
              ),
            })
          );
        }
      );
      out.on("error", reject);
      out.end(body);
    });
    return new Response(new Uint8Array(tamper ? tamper(buf) : buf), {
      status,
      headers,
    });
  }) as typeof fetch;
}

/** Inbound audit outcomes on a route, oldest first. */
export const outcomesOf = (route: string) =>
  (
    getDb()
      .prepare(`SELECT outcome FROM peer_audit WHERE route = ? ORDER BY id`)
      .all(route) as { outcome: string }[]
  ).map((r) => r.outcome);

/** A raw POST to a machine's rpc through the edge. */
export async function post(m: Machine, body: Buffer) {
  const res = await fetch(`https://${m.hostname}/api/peer/rpc`, {
    method: "POST",
    body: new Uint8Array(body),
  });
  return { status: res.status, text: await res.text() };
}

/** An envelope sent to the tunnel only up to `upTo` bytes, the rest held back. */
export function partial(m: Machine, envelope: Buffer, upTo: number) {
  const out = http.request({
    host: "127.0.0.1",
    port: m.tunnelPort,
    method: "POST",
    path: "/api/peer/rpc",
    headers: { host: m.hostname, "content-length": String(envelope.length) },
  });
  let answered = false;
  const response = new Promise<{ status: number; text: string }>(
    (resolve, reject) => {
      out.on("response", (res) => {
        answered = true;
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      });
      out.on("error", (err) => (answered ? undefined : reject(err)));
    }
  );
  response.catch(() => {});
  const closed = new Promise((r) => out.on("close", r));
  if (upTo > 0) out.write(envelope.subarray(0, upTo));
  else out.flushHeaders();
  return {
    response,
    closed,
    within: (ms: number) =>
      Promise.race([
        response.then(() => "answered"),
        new Promise((r) => setTimeout(() => r("pending"), ms)),
      ]),
    finish: () => out.end(envelope.subarray(upTo)),
    destroy: () => out.destroy(),
  };
}
