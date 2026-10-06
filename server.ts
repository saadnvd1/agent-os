import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { buildAttachProcess, type AttachSpec } from "./lib/hosts/attach";
import { sshTargetFor } from "./lib/hosts";
import { agentEnv, ensureBusBrief } from "./lib/agents/launch";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";

// Support: npm run dev -- -p 3012
const pFlagIndex = process.argv.indexOf("-p");
const portArg = pFlagIndex !== -1 ? process.argv[pFlagIndex + 1] : undefined;
const port = parseInt(portArg || process.env.PORT || "3011", 10);
process.env.AGENTOS_PORT = String(port);
ensureBusBrief();

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  // Terminal WebSocket server
  const terminalWss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrades
  server.on("upgrade", (request, socket, head) => {
    const { pathname } = parse(request.url || "");

    if (pathname === "/ws/terminal") {
      terminalWss.handleUpgrade(request, socket, head, (ws) => {
        terminalWss.emit("connection", ws, request);
      });
    }
    // Let HMR and other WebSocket connections pass through to Next.js
  });

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
        // Local sessions join the agent bus: who they are and where AgentOS is.
        if (spec.sessionId && !sshTarget) spec.env = agentEnv(spec.sessionId);
        const { file, args } = buildAttachProcess(spec, sshTarget, shell);
        start(file, args, true);
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

  server.listen(port, () => {
    console.log(`> Agent-OS ready on http://${hostname}:${port}`);
  });
});
