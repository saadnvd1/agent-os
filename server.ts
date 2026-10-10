import { createServer, type IncomingMessage } from "http";
import type { Duplex } from "stream";
import type { Socket } from "net";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { ensureBusBrief } from "./lib/agents/launch";
import { reattachChats } from "./lib/chat/runner";
import { serveChatSocket } from "./lib/chat/socket";
import { startStackWatcher } from "./lib/stacks";
import { setStartGate } from "./lib/stacks/tick";
import { stackStartGate } from "./lib/orchestrator/brakes";
import { buildId } from "./lib/build";
import { startOrchestratorWatcher } from "./lib/orchestrator/watcher";
import { realDeps, schedulesEnabled, startScheduler } from "./lib/schedules";
import { resumePhoneOutbox } from "./lib/notify";
import {
  bindAddresses,
  requestAllowed,
  tailscaleAddresses,
  upgradeAllowed,
  type AccessPolicy,
} from "./lib/security/net";
import { authPolicy, gateRequest, gateUpgrade } from "./lib/security/gate";
import {
  assertDemoSandbox,
  demoAllowsUpgrade,
  admitDemoSocket,
  demoMode,
  gateDemoRequest,
  refuseDemoUpgrade,
  socketLimiter,
} from "./lib/security/demo";
import { startDemoReseed } from "./lib/demo-reseed";
import { upgradePath } from "./lib/security/upgrade-path";
import {
  refuseAbsoluteTarget,
  refuseNextInternal,
} from "./lib/security/next-internals";
import { lanEnabled } from "./lib/security/network-settings";
import { startConnect } from "./lib/connect/serve";
import { startTailnetHttps } from "./lib/security/tailnet-https";
import {
  setStatusSource,
  setTopicSignature,
  setRunFinished,
} from "./lib/status/hub";
import { serveStatusSocket, sessionFolder } from "./lib/status/socket";
import { refreshGitSoon } from "./lib/git-poller";
import { changeWatcher } from "./lib/db/changes";
import { getDb } from "./lib/db";
import { discoveredSignature } from "./lib/hosts/discover-signature";
import { sendBounded, DEFLATE } from "./lib/ws-send";
import { compressJson } from "./lib/http-compress";
import { loadEnabled, startLoadMonitor } from "./lib/load/monitor";
import { collectStatuses, terminalsChanged } from "./lib/status/collect";
import { startProgramStatusTap } from "./lib/program-status/tap";
import { startTmuxControl } from "./lib/tmux/start";
import { serveTerminal } from "./lib/terminal/connection";
import { installClaudeStatusHooks } from "./lib/program-status/claude-hooks";
import os from "os";
import { resumeHeldStarts, resumeTaskStarts } from "./lib/tasks/start";
import { failInterruptedSetups } from "./lib/sessions/worktree-setup";
import { claimAgentosEnv } from "./lib/agents/self-env";

const dev = process.env.NODE_ENV !== "production";
const hostname = "127.0.0.1";

// Support: npm run dev -- -p 3012
const pFlagIndex = process.argv.indexOf("-p");
const portArg = pFlagIndex !== -1 ? process.argv[pFlagIndex + 1] : undefined;
const port = parseInt(portArg || process.env.PORT || "3011", 10);
claimAgentosEnv(port);
// Demo mode: seeded data, nothing that runs code (lib/security/demo).
const demo = demoMode();
if (demo) assertDemoSandbox();
// Fixed for this process and handed to the chat workers it starts.
buildId();
if (!demo) {
  ensureBusBrief();
  installClaudeStatusHooks();
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  const policy: AccessPolicy = {
    bound: [],
    extraHosts: [],
  };
  const configuredHosts = (process.env.AGENTOS_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const auth = authPolicy();
  const header = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;

  const onRequest: Parameters<typeof createServer>[1] = async (req, res) => {
    // Paths only: every check below reads the target as one.
    if (refuseAbsoluteTarget(req, res)) return;
    if (
      !requestAllowed(
        {
          method: req.method,
          url: req.url,
          host: header(req.headers.host),
          origin: header(req.headers.origin),
          fetchSite: header(req.headers["sec-fetch-site"]),
          fetchMode: header(req.headers["sec-fetch-mode"]),
        },
        policy
      )
    ) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
    // Next's image optimizer re-fetches any URL past these gates.
    if (refuseNextInternal(req, res)) return;
    if (!gateRequest(req, res, auth)) return;
    if (demo && !gateDemoRequest(req, res)) return;
    try {
      await compressJson(req, res);
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  };

  // Terminal WebSocket server
  const terminalWss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: DEFLATE,
  });

  // Session status and what changed, pushed (lib/status/hub). `v=2` asks for
  // the numbered stream and resumes from `epoch`/`seq`; without it, the whole
  // map on connect and on every change.
  setStatusSource(collectStatuses, terminalsChanged, changeWatcher(getDb));
  setTopicSignature("discovered", discoveredSignature);
  // A finished run likely changed files: the git panel showing them updates.
  setRunFinished((id) => {
    const folder = sessionFolder(id);
    if (folder) refreshGitSoon(folder);
  });
  // Terminal sessions are watched through tmux control mode, or tapped with
  // pipe-pane where tmux is too old for it.
  const control = await startTmuxControl();
  const programTap = control ?? startProgramStatusTap(port);
  // A demo's visitors are strangers: their status and chat sockets are capped.
  const statusSlots = socketLimiter();
  const chatSlots = socketLimiter();
  const statusWss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: DEFLATE,
  });
  statusWss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    const params = new URL(request.url ?? "", "http://x").searchParams;
    serveStatusSocket(ws, params, (json) => sendBounded(ws, json));
  });

  // Chat: one socket per watched session. Sends a snapshot, then live items;
  // takes messages and interrupts.
  const chatWss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: DEFLATE,
  });
  chatWss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    const params = new URL(request.url ?? "", "http://x").searchParams;
    serveChatSocket(ws, params, (json) => sendBounded(ws, json), demo);
  });

  // Handle WebSocket upgrades
  const onUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer
  ) => {
    if (
      !upgradeAllowed(
        {
          host: header(request.headers.host),
          origin: header(request.headers.origin),
        },
        policy
      )
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!gateUpgrade(request, socket, auth)) return;
    const pathname = upgradePath(request.url);
    if (pathname === null) {
      socket.destroy();
      return;
    }
    if (demo && !demoAllowsUpgrade(pathname)) {
      refuseDemoUpgrade(socket);
      return;
    }

    if (pathname === "/ws/chat") {
      chatWss.handleUpgrade(request, socket, head, (ws) => {
        if (demo && !admitDemoSocket(ws, request, chatSlots)) return;
        chatWss.emit("connection", ws, request);
      });
      return;
    }

    if (pathname === "/ws/status") {
      statusWss.handleUpgrade(request, socket, head, (ws) => {
        if (demo && !admitDemoSocket(ws, request, statusSlots)) return;
        statusWss.emit("connection", ws, request);
      });
      return;
    }

    if (pathname === "/ws/terminal") {
      terminalWss.handleUpgrade(request, socket, head, (ws) => {
        terminalWss.emit("connection", ws, request);
      });
    }
    // Let HMR and other WebSocket connections pass through to Next.js
  };

  // Terminal connections: a shell of their own, or a session's view shared
  // with every other view of it (lib/terminal/connection).
  terminalWss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    const params = new URL(request.url ?? "", "http://x").searchParams;
    serveTerminal(ws, params, {
      rescan: () => programTap.rescan(),
      send: (data) => void sendBounded(ws, data),
    });
  });

  // One listener per allowed address: loopback and Tailscale by default,
  // Wi-Fi only when Settings → Devices turns it on (or AGENTOS_BIND opts in).
  // Addresses come and go (Tailscale starts late, Wi-Fi changes), so the set
  // is re-read every few seconds and listeners follow it.
  const listeners = new Map<string, ReturnType<typeof createServer>>();
  const sockets = new Map<string, Set<Socket>>();
  const listenOn = (address: string) => {
    if (listeners.has(address)) return;
    policy.bound.push(address);
    const server = createServer(onRequest);
    listeners.set(address, server);
    // Kept so that turning an address off also cuts its open terminals and
    // chats (upgraded sockets outlive server.close()).
    const open = new Set<Socket>();
    sockets.set(address, open);
    server.on("connection", (s: Socket) => {
      open.add(s);
      s.once("close", () => open.delete(s));
    });
    server.on("upgrade", onUpgrade);
    server.on("error", (err) => {
      console.error(`Could not listen on ${address}:${port}:`, err.message);
      stopListening(address);
    });
    server.listen(port, address, () => {
      console.log(`> Agent-OS ready on http://${address}:${port}`);
    });
  };
  const stopListening = (address: string) => {
    listeners.get(address)?.close();
    listeners.delete(address);
    for (const s of sockets.get(address) ?? []) s.destroy();
    sockets.delete(address);
    policy.bound = policy.bound.filter((a) => a !== address);
  };
  const refreshListeners = () => {
    const lan = lanEnabled();
    const wanted = bindAddresses(process.env.AGENTOS_BIND, undefined, lan);
    wanted.forEach(listenOn);
    for (const address of listeners.keys()) {
      if (address !== "127.0.0.1" && !wanted.includes(address)) {
        console.log(`> Agent-OS stopped listening on ${address}`);
        stopListening(address);
      }
    }
    const connectHost = connect.hostname();
    policy.extraHosts = [
      ...configuredHosts,
      ...(connectHost ? [connectHost] : []),
      ...(lan
        ? [
            os
              .hostname()
              .toLowerCase()
              .replace(/\.local$/, "") + ".local",
          ]
        : []),
    ];
  };
  // AgentOS Connect: reachable at <id>.<machine domain> through the relay.
  const connect = demo
    ? { hostname: () => null }
    : startConnect({ onRequest, onUpgrade }, port);
  // HTTPS on the tailnet (its own port) for passkeys and other secure-origin APIs.
  if (
    !demo &&
    process.env.AGENTOS_TAILNET_HTTPS !== "0" &&
    !process.env.AGENTOS_BIND
  ) {
    startTailnetHttps({
      handlers: { onRequest, onUpgrade },
      port,
      addresses: () => tailscaleAddresses(),
    });
  }
  refreshListeners();
  if (!process.env.AGENTOS_BIND) setInterval(refreshListeners, 5000);
  if (process.env.AGENTOS_AUTH === "off" && listeners.size > 1) {
    console.warn(
      "> WARNING: AGENTOS_AUTH=off and listening beyond loopback. Anyone who can reach this port gets a shell."
    );
  }
  // A demo starts nothing on its own: no agents, tasks, stacks or schedules.
  if (demo) {
    console.log("> Demo mode: agents don't run, and nothing runs code");
    // Visitors share it: back to the seed every few minutes, while serving.
    // Open chats show history the restore replaced: they reconnect (1012,
    // service restart) and read it again.
    startDemoReseed(getDb(), `${process.env.DB_PATH}.seed`, undefined, () => {
      for (const ws of chatWss.clients) ws.close(1012, "Demo reset");
    });
    return;
  }
  // New sessions whose worktree setup a restart cut off.
  failInterruptedSetups();
  // Chat turns that kept running through a restart.
  void reattachChats();
  // Task starts this restart cut off: set up and launch them now.
  resumeTaskStarts().catch((error) =>
    console.error("Resuming task starts failed:", error)
  );
  // Starts held by Pause or the brakes launch once the hold clears.
  setInterval(() => {
    try {
      resumeHeldStarts();
    } catch (error) {
      console.error("Resuming held task starts failed:", error);
    }
  }, 60_000);
  // Stacks start their next cards from here; their state is in the database.
  setStartGate(stackStartGate);
  if (process.env.AGENTOS_STACKS !== "off") startStackWatcher();
  // Each workspace's orchestrator hears about its sessions as events.
  if (process.env.AGENTOS_ORCHESTRATOR !== "off") startOrchestratorWatcher();
  // Schedules tick here, once a minute, and nowhere else.
  if (schedulesEnabled(process.env)) startScheduler(realDeps);
  resumePhoneOutbox();
  // Machine load: a gauge, notes on heavy commands, one alert when red.
  if (loadEnabled()) startLoadMonitor();
});
