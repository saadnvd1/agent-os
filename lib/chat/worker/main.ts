/**
 * A chat worker: one conversation, in its own process (hosted in tmux), so
 * restarting AgentOS never cuts off a turn. The server talks to it over a
 * Unix socket and reattaches after a restart.
 *
 *   node --import tsx lib/chat/worker/main.ts <session id>
 */

import fs from "fs";
import net from "net";
import { envPath, lineReader, PROTOCOL_VERSION, socketPath } from "./protocol";
import { buildId } from "../../build";
import type { WorkerCommand, WorkerEvent } from "./protocol";
import type { Session } from "../../db";

const IDLE_EXIT_MS = 30 * 60 * 1000;

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("usage: main.ts <session id>");
  process.exit(2);
}

// The server's environment, handed over in a private file rather than on the
// tmux command line.
const envFile = envPath(sessionId);
if (fs.existsSync(envFile)) {
  Object.assign(process.env, JSON.parse(fs.readFileSync(envFile, "utf8")));
  fs.rmSync(envFile, { force: true });
}
// tmux puts its own socket in the pane's environment, and a tmux command
// the agent runs reaches it before TMUX_TMPDIR or the default: a dev
// instance's `tmux kill-server` would end every chat worker (2026-10-10).
delete process.env.TMUX;
delete process.env.TMUX_PANE;

// Imported after the environment is in place: the database opens on import.
async function main(sessionId: string) {
  const { db } = await import("../../db");
  const { ChatHost } = await import("./host");

  const session = db
    .prepare(`SELECT * FROM sessions WHERE id = ?`)
    .get(sessionId) as Session | undefined;
  if (!session) {
    console.error(`No session ${sessionId}`);
    process.exit(1);
  }

  const clients = new Set<net.Socket>();
  const emit = (e: WorkerEvent) => {
    const line = `${JSON.stringify(e)}\n`;
    for (const c of clients) c.write(line);
  };

  const extras = await (await import("./extras")).roleExtras(session);

  let idleTimer: NodeJS.Timeout | undefined;
  const host = new ChatHost(
    session,
    (e) => {
      emit(e);
      if (e.type === "state") armIdle();
    },
    extras
  );
  function armIdle() {
    clearTimeout(idleTimer);
    if (host.state === "idle")
      idleTimer = setTimeout(() => host.close(), IDLE_EXIT_MS);
  }
  armIdle();

  const sock = socketPath(sessionId);
  fs.rmSync(sock, { force: true });
  const server = net.createServer((client) => {
    clients.add(client);
    client.write(
      `${JSON.stringify({
        type: "hello",
        version: PROTOCOL_VERSION,
        build: buildId(),
        state: host.state,
        streaming: [...host.streaming.values()],
        caps: ["plan", "queue"],
      } satisfies WorkerEvent)}\n`
    );
    client.on(
      "data",
      lineReader((m) => {
        void host.handle(m as WorkerCommand).catch((error) => {
          console.error("Chat command failed:", error);
          emit({
            type: "item",
            item: {
              id: `error-${Date.now()}`,
              kind: "error",
              message: error instanceof Error ? error.message : String(error),
              createdAt: Date.now(),
            },
          });
        });
      })
    );
    client.on("close", () => clients.delete(client));
    client.on("error", () => clients.delete(client));
  });
  server.listen(sock, () => fs.chmodSync(sock, 0o600));

  // A driver's stray failure is logged, not fatal: the conversation and
  // the messages it holds outlive one bad call.
  process.on("unhandledRejection", (error) =>
    console.error("Unhandled in chat worker:", error)
  );

  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
    process.on(signal, () => host.close());

  // A closing worker takes no new connections, so the next message starts
  // a fresh one rather than reaching this one on its way out.
  host.onClose = () => {
    server.close();
    fs.rmSync(sock, { force: true });
  };
  await host.done;
  host.onClose();
  process.exit(0);
}

void main(sessionId);
