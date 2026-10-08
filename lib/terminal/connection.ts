import type { EventEmitter } from "events";
import * as pty from "node-pty";
import { buildAttachProcess, type AttachSpec } from "../hosts/attach";
import { sshTargetFor } from "../hosts";
import { agentEnv } from "../agents/launch";
import { launchPending } from "../tasks/start";
import {
  SharedAttach,
  SharedAttaches,
  newViewer,
  type Viewer,
} from "./shared-attach";

/**
 * One /ws/terminal connection: a plain shell of its own, or a view of a
 * session shared with every other view of it (lib/terminal/shared-attach).
 * The shell starts only if no attach comes first: a session's view never
 * pays for a login shell it replaces at once. `?flow=1` clients ack each
 * output message, for flow control.
 */

// Long enough for the page's attach to arrive right after it connects.
export const SHELL_AFTER_MS = 400;

const shared = new SharedAttaches();
export const sharedAttachCount = () => shared.count();

function terminalEnv(): Record<string, string> {
  const shell = process.env.SHELL || "/bin/zsh";
  // Only essentials, so a dev server started in it loads its own .env
  // without this process's environment in the way.
  const env: Record<string, string> = {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME || "/",
    USER: process.env.USER || "",
    SHELL: shell,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "en_US.UTF-8",
  };
  if (process.env.SSH_AUTH_SOCK) env.SSH_AUTH_SOCK = process.env.SSH_AUTH_SOCK;
  // The tmux server this AgentOS runs against, not the default one.
  if (process.env.TMUX_TMPDIR) env.TMUX_TMPDIR = process.env.TMUX_TMPDIR;
  return env;
}

const dimension = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.min(Math.max(Math.floor(n), 2), 1000)
    : fallback;

export interface TerminalSocket extends EventEmitter {
  readyState: number;
  send(data: string): void;
  close(): void;
}

export function serveTerminal(
  ws: TerminalSocket,
  params: URLSearchParams,
  { rescan, send }: { rescan: () => void; send: (data: string) => void }
): void {
  const shell = process.env.SHELL || "/bin/zsh";
  const env = terminalEnv();
  const flow = params.get("flow") === "1";
  let cols = 80;
  let rows = 24;
  let own: pty.IPty | null = null;
  let view: { attach: SharedAttach; viewer: Viewer } | null = null;
  let closed = false;
  const reply = (msg: object) => send(JSON.stringify(msg));

  // This connection's own shell; replacing one isn't the terminal exiting.
  const startShell = () => {
    if (closed) return;
    const previous = own;
    own = null;
    previous?.kill();
    const proc = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: process.env.HOME || "/",
      env,
    });
    own = proc;
    proc.onData((data) => {
      if (own === proc) reply({ type: "output", data });
    });
    proc.onExit(({ exitCode }) => {
      if (own !== proc) return;
      own = null;
      reply({ type: "exit", code: exitCode });
      ws.close();
    });
  };
  let shellTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    shellTimer = null;
    if (!view && !own) startShell();
  }, SHELL_AFTER_MS);
  const cancelShell = () => {
    if (shellTimer) clearTimeout(shellTimer);
    shellTimer = null;
  };

  const leave = () => {
    if (!view) return;
    view.attach.leave(view.viewer);
    view = null;
  };

  const attach = (spec: AttachSpec) => {
    try {
      const sshTarget = sshTargetFor(spec.hostId);
      // A task still setting up gets its tmux session from its launch;
      // creating it here would start a bare agent without the task.
      if (spec.sessionId && !sshTarget && launchPending(spec.sessionId)) {
        reply({
          type: "output",
          data: "\r\nThis task is still setting up. Open it again once its agent has started.\r\n",
        });
        return;
      }
      // Local sessions join the agent bus: who they are and where AgentOS is.
      if (spec.sessionId && !sshTarget) spec.env = agentEnv(spec.sessionId);
      const { file, args } = buildAttachProcess(spec, sshTarget, shell);
      cancelShell();
      const previous = own;
      own = null;
      previous?.kill();
      leave();
      const viewer = newViewer(
        send,
        (code) => {
          // tmux detached (or the session ended): back to a shell, as a
          // terminal left after `tmux detach` would be.
          if (view?.viewer !== viewer) return;
          view = null;
          reply({ type: "detached", code });
          startShell();
        },
        flow,
        cols,
        rows
      );
      const key = `${spec.hostId || "local"}:${spec.sessionName}`;
      const shared_ = shared.open(
        key,
        (onGone) =>
          new SharedAttach(
            pty.spawn(file, args, {
              name: "xterm-256color",
              cols,
              rows,
              cwd: process.env.HOME || "/",
              env,
            }),
            cols,
            rows,
            onGone
          )
      );
      view = { attach: shared_, viewer };
      shared_.join(viewer);
      if (!sshTarget) rescan();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply({ type: "output", data: `\r\n\x1b[31m${message}\x1b[0m\r\n` });
    }
  };

  const write = (data: string) => {
    if (view) view.attach.input(data);
    else {
      if (!own) {
        cancelShell();
        startShell();
      }
      own?.write(data);
    }
  };

  ws.on("message", (message: Buffer) => {
    let msg: {
      type?: unknown;
      data?: unknown;
      cols?: unknown;
      rows?: unknown;
      spec?: unknown;
    };
    try {
      msg = JSON.parse(message.toString());
    } catch {
      return;
    }
    switch (msg.type) {
      case "input":
        if (typeof msg.data === "string") write(msg.data);
        break;
      case "command":
        if (typeof msg.data === "string") write(msg.data + "\r");
        break;
      case "resize":
        cols = dimension(msg.cols, cols);
        rows = dimension(msg.rows, rows);
        if (view) view.attach.resize(view.viewer, cols, rows);
        else own?.resize(cols, rows);
        break;
      case "ack":
        if (view) view.attach.ack(view.viewer);
        break;
      case "attach":
        if (msg.spec && typeof msg.spec === "object")
          attach(msg.spec as AttachSpec);
        break;
    }
  });

  const shutdown = () => {
    if (closed) return;
    closed = true;
    cancelShell();
    leave();
    const proc = own;
    own = null;
    proc?.kill();
  };
  ws.on("close", shutdown);
  ws.on("error", shutdown);
}
