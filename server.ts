import { createServer, type IncomingMessage } from "http";
import type { Duplex } from "stream";
import type { Socket } from "net";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { buildAttachProcess, type AttachSpec } from "./lib/hosts/attach";
import { sshTargetFor } from "./lib/hosts";
import { agentEnv, ensureBusBrief } from "./lib/agents/launch";
import {
  chatFileSuggestions,
  chatHistory,
  chatTaskOutput,
  chatToolBody,
  deleteQueuedChat,
  editQueuedChat,
  interruptChat,
  moveQueuedChat,
  reattachChats,
  respondChat,
  sendChat,
  sendQueuedNow,
  setChatAccess,
  setChatPlan,
  carryOutPlan,
  setChatModel,
  stopChatTask,
  undoChat,
  watchChat,
} from "./lib/chat/runner";
import { clientSend } from "./lib/chat/client-send";
import { titleChatFromMessage } from "./lib/session-titles";
import type { ChatClientMessage, ChatServerMessage } from "./lib/chat/events";
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
import { upgradePath } from "./lib/security/upgrade-path";
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
import { installClaudeStatusHooks } from "./lib/program-status/claude-hooks";
import os from "os";
import {
  launchPending,
  resumeHeldStarts,
  resumeTaskStarts,
} from "./lib/tasks/start";
import { failInterruptedSetups } from "./lib/sessions/worktree-setup";

const dev = process.env.NODE_ENV !== "production";
const hostname = "127.0.0.1";

// Support: npm run dev -- -p 3012
const pFlagIndex = process.argv.indexOf("-p");
const portArg = pFlagIndex !== -1 ? process.argv[pFlagIndex + 1] : undefined;
const port = parseInt(portArg || process.env.PORT || "3011", 10);
process.env.AGENTOS_PORT = String(port);
// Fixed for this process and handed to the chat workers it starts.
buildId();
ensureBusBrief();
installClaudeStatusHooks();

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
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
    if (!gateRequest(req, res, auth)) return;
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
  const programTap = startProgramStatusTap(port);
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
    const sessionId = params.get("session");
    if (!sessionId) return ws.close();
    const reply = (m: ChatServerMessage) => sendBounded(ws, JSON.stringify(m));
    const fail = (err: unknown) =>
      reply({
        type: "item",
        item: {
          id: `error-${Date.now()}`,
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
          createdAt: Date.now(),
        },
      });
    const unwatch = watchChat(sessionId, reply, params.get("paged") === "1");
    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as ChatClientMessage;
        if (msg.type === "send") {
          const send = clientSend(msg);
          void sendChat(sessionId, { ...send, queue: true }).catch(fail);
          // "Session 4" is named after its first message.
          void titleChatFromMessage(sessionId, send.text);
        } else if (msg.type === "queue_edit" && typeof msg.text === "string")
          editQueuedChat(sessionId, String(msg.id), msg.text);
        else if (msg.type === "queue_move")
          moveQueuedChat(sessionId, String(msg.id), msg.by === -1 ? -1 : 1);
        else if (msg.type === "queue_delete")
          deleteQueuedChat(sessionId, String(msg.id));
        else if (msg.type === "queue_send_now")
          void sendQueuedNow(
            sessionId,
            String(msg.id),
            typeof msg.during === "string" ? msg.during : undefined
          ).catch(fail);
        else if (msg.type === "files" && typeof msg.query === "string")
          void chatFileSuggestions(sessionId, msg.query.slice(0, 200))
            .then((files) =>
              reply({
                type: "files",
                reqId: String(msg.reqId),
                query: msg.query,
                files,
              })
            )
            .catch(() =>
              reply({
                type: "files",
                reqId: String(msg.reqId),
                query: msg.query,
                files: [],
              })
            );
        else if (msg.type === "interrupt") void interruptChat(sessionId);
        else if (msg.type === "set_model")
          void setChatModel(sessionId, msg.model);
        else if (msg.type === "set_access")
          void setChatAccess(sessionId, msg.access);
        else if (msg.type === "set_plan")
          void setChatPlan(sessionId, !!msg.plan).catch(fail);
        else if (msg.type === "carry_plan")
          void carryOutPlan(sessionId, String(msg.id)).catch(fail);
        else if (msg.type === "respond") respondChat(sessionId, msg.id, msg);
        else if (msg.type === "stop_task") stopChatTask(sessionId, msg.taskId);
        else if (msg.type === "task_output")
          reply({
            type: "task_output",
            taskId: msg.taskId,
            text: chatTaskOutput(sessionId, msg.taskId),
          });
        else if (msg.type === "history" && Number.isFinite(msg.before))
          reply({
            type: "history",
            before: msg.before,
            ...chatHistory(sessionId, msg.before),
          });
        else if (msg.type === "tool_body")
          reply({
            type: "tool_body",
            id: String(msg.id),
            body: chatToolBody(sessionId, String(msg.id)),
          });
        else if (msg.type === "undo")
          void undoChat(sessionId, msg.from, !!msg.dryRun, reply).catch((err) =>
            reply({
              type: "undo_preview",
              from: msg.from,
              preview: {
                canUndo: false,
                files: [],
                error: err instanceof Error ? err.message : String(err),
              },
            })
          );
      } catch (err) {
        fail(err);
      }
    });
    ws.on("close", unwatch);
    ws.on("error", unwatch);
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

    if (pathname === "/ws/chat") {
      chatWss.handleUpgrade(request, socket, head, (ws) => {
        chatWss.emit("connection", ws, request);
      });
      return;
    }

    if (pathname === "/ws/status") {
      statusWss.handleUpgrade(request, socket, head, (ws) => {
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

  // Terminal connections
  terminalWss.on("connection", (ws: WebSocket) => {
    const shell = process.env.SHELL || "/bin/zsh";
    // Use minimal env - only essentials for shell to work
    // This lets Next.js/Vite/etc load .env.local without interference from parent process env
    const minimalEnv: { [key: string]: string } = {
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
      HOME: process.env.HOME || "/",
      USER: process.env.USER || "",
      SHELL: shell,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LANG: process.env.LANG || "en_US.UTF-8",
    };
    if (process.env.SSH_AUTH_SOCK) {
      minimalEnv.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
    }
    // Attach to the tmux server this AgentOS runs against, not the default one.
    if (process.env.TMUX_TMPDIR) {
      minimalEnv.TMUX_TMPDIR = process.env.TMUX_TMPDIR;
    }

    let ptyProcess: pty.IPty | null = null;
    let cols = 80;
    let rows = 24;

    const send = (msg: object) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    // Replacing a process (attach, or back to a shell after detaching) must
    // not be reported to the client as the terminal exiting.
    const start = (file: string, args: string[], attached: boolean) => {
      const previous = ptyProcess;
      ptyProcess = null;
      previous?.kill();

      const proc = pty.spawn(file, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: process.env.HOME || "/",
        env: minimalEnv,
      });
      ptyProcess = proc;

      proc.onData((data: string) => {
        if (ptyProcess === proc) send({ type: "output", data });
      });
      proc.onExit(({ exitCode }) => {
        if (ptyProcess !== proc) return;
        if (attached && ws.readyState === WebSocket.OPEN) {
          send({ type: "detached", code: exitCode });
          start(shell, [], false);
          return;
        }
        send({ type: "exit", code: exitCode });
        ws.close();
      });
    };

    const attach = (spec: AttachSpec) => {
      try {
        const sshTarget = sshTargetFor(spec.hostId);
        // A task still setting up gets its tmux session from its launch;
        // creating it here would start a bare agent without the task.
        if (spec.sessionId && !sshTarget && launchPending(spec.sessionId)) {
          send({
            type: "output",
            data: "\r\nThis task is still setting up. Open it again once its agent has started.\r\n",
          });
          return;
        }
        // Local sessions join the agent bus: who they are and where AgentOS is.
        if (spec.sessionId && !sshTarget) spec.env = agentEnv(spec.sessionId);
        const { file, args } = buildAttachProcess(spec, sshTarget, shell);
        start(file, args, true);
        if (!sshTarget) programTap.rescan();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "output", data: `\r\n\x1b[31m${message}\x1b[0m\r\n` });
      }
    };

    try {
      start(shell, [], false);
    } catch (err) {
      console.error("Failed to spawn pty:", err);
      send({ type: "error", message: "Failed to start terminal" });
      ws.close();
      return;
    }

    ws.on("message", (message: Buffer) => {
      try {
        const msg = JSON.parse(message.toString());
        switch (msg.type) {
          case "input":
            ptyProcess?.write(msg.data);
            break;
          case "resize":
            cols = msg.cols;
            rows = msg.rows;
            ptyProcess?.resize(msg.cols, msg.rows);
            break;
          case "command":
            ptyProcess?.write(msg.data + "\r");
            break;
          case "attach":
            attach(msg.spec as AttachSpec);
            break;
        }
      } catch (err) {
        console.error("Error parsing message:", err);
      }
    });

    const shutdown = () => {
      const proc = ptyProcess;
      ptyProcess = null;
      proc?.kill();
    };
    ws.on("close", shutdown);
    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      shutdown();
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
  const connect = startConnect({ onRequest, onUpgrade }, port);
  // HTTPS on the tailnet (its own port) for passkeys and other secure-origin APIs.
  if (process.env.AGENTOS_TAILNET_HTTPS !== "0" && !process.env.AGENTOS_BIND) {
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
