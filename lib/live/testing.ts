/**
 * For tests: a fake Connect (its control API and its cable) and a Drive-ready
 * task session, so a test can mint a live share, play Connect's side of the
 * socket and watch what goes up. Import it before ./service.
 */

import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import { randomUUID } from "crypto";
import type { AddressInfo } from "net";
import { tempDir } from "@/lib/test-temp";
import type { WorkerCommand } from "@/lib/chat/worker/protocol";

export const SHARE = "live00000001";

export async function liveHarness() {
  const dir = tempDir("agentos-live-");
  const keys = crypto.generateKeyPairSync("ed25519");
  const seen: { method: string; url: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method!, url: req.url!, body });
      const mint = req.method === "POST" && req.url!.endsWith("/live-shares");
      res.writeHead(mint ? 201 : 200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify(
          mint
            ? {
                id: SHARE,
                url: "https://runagentos.com/s/tok",
                status: "active",
                expires_at: new Date(Date.now() + 3600_000).toISOString(),
                ends_with_session: false,
                max_guests: 5,
              }
            : { id: SHARE, status: "revoked" }
        )
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.AGENTOS_CONNECT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "connect.json"),
    JSON.stringify({
      machineId: "abcd1234",
      hostname: "m-0123456789abcdef.runagentos.com",
      apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      enabled: true,
    }),
    { mode: 0o600 }
  );
  fs.writeFileSync(
    path.join(dir, "machine.key"),
    keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    { mode: 0o600 }
  );

  const { live } = await import("./runtime");
  const svc = await import("./service");
  const { getDb } = await import("@/lib/db");
  const { createProject } = await import("@/lib/projects");
  const { seedSession } = await import("@/lib/orchestrator/testing");
  const { writePart } = await import("@/lib/db/session-parts");
  const { partOf } = await import("@/lib/db/session-parts/columns");

  /** Sets session columns, wherever each one lives. */
  function setColumns(id: string, set: Record<string, unknown>) {
    for (const [k, v] of Object.entries(set)) {
      const part = partOf(k);
      if (part) writePart(getDb(), part, id, { [k]: v } as never);
      else
        getDb().prepare(`UPDATE sessions SET ${k} = ? WHERE id = ?`).run(v, id);
    }
  }

  interface Fake {
    out: Record<string, unknown>[];
    handlers: Record<string, (d?: unknown) => void>;
  }
  let fake: Fake | null = null;
  const factory = () => {
    const f: Fake = { out: [], handlers: {} };
    fake = f;
    return {
      readyState: 1,
      send: (d: string) => f.out.push(JSON.parse(d)),
      close: () => {},
      terminate: () => {},
      on: (e: string, fn: (d?: unknown) => void) => {
        f.handlers[e] = fn;
      },
    };
  };
  const ident = JSON.stringify({ channel: "LiveHostChannel", share_id: SHARE });

  /** A frame from Connect, as it arrives on the cable. */
  const down = (frame: Record<string, unknown>) =>
    fake!.handlers.message(
      JSON.stringify({
        identifier: ident,
        message: { share_id: SHARE, ...frame },
      })
    );

  /** What this machine sent up, by action. */
  const up = (action?: string) =>
    fake!.out
      .filter((m) => m.command === "message")
      .map((m) => JSON.parse(m.data as string) as Record<string, unknown>)
      .filter((m) => !action || m.action === action);

  /** A Claude task chat in its own worktree: what Drive needs. */
  function taskChat(
    cwd = tempDir("agentos-wt-"),
    change: Record<string, unknown> = {}
  ): string {
    const project = createProject({
      name: `p-${randomUUID().slice(0, 6)}`,
      workingDirectory: tempDir("agentos-main-"),
    });
    const id = seedSession({
      projectId: project.id,
      name: "Pairing",
      view: "chat",
      task: true,
    });
    setColumns(id, {
      agent_type: "claude",
      task_prompt: "build the thing",
      worktree_path: cwd,
      working_directory: cwd,
      ...change,
    });
    return id;
  }

  async function open(
    sessionId: string,
    level: "watch" | "suggest" | "drive" = "drive"
  ) {
    const view = await svc.createLive(sessionId, "1h", level, true);
    fake!.handlers.message(JSON.stringify({ type: "welcome" }));
    fake!.handlers.message(
      JSON.stringify({ type: "confirm_subscription", identifier: ident })
    );
    return view;
  }

  function admit(gid = "g00000000001", name = "Ahmed", drive = false) {
    down({ type: "join_request", guest: { id: gid, name } });
    svc.admit(SHARE, gid, { drive });
    down({ type: "presence", guest: { id: gid, name }, online: true });
  }

  const { gatedHost, tick } = await import("@/lib/chat/worker/gate-testing");
  const { registry, getSession } = await import("@/lib/chat/registry");
  const { listQueue } = await import("@/lib/chat/queued");
  const { onDriveMessage } = await import("./drive");
  const publisher = await import("./publisher");
  const fx = {
    send: (id: string, action: string, data?: Record<string, unknown>) =>
      live.socket?.send(id, action, data),
  };
  const settle = async () => {
    for (let i = 0; i < 6; i++) await tick();
  };

  /**
   * A task chat with its live share at `level`, a guest admitted (at the
   * wheel unless suggest), and a real chat worker over a stub agent
   * registered as its live one. The test file mocks the drivers with
   * gate-testing's. `publish` also sends its items up, as the publisher
   * would (paced, so statuses can arrive late).
   */
  async function driving(
    opts: {
      level?: "suggest" | "drive";
      guestId?: string;
      publish?: boolean;
    } = {}
  ) {
    const guestId = opts.guestId ?? "g00000000001";
    const sessionId = taskChat();
    const session = getSession(sessionId);
    const commands: WorkerCommand[] = [];
    const w = await gatedHost(session, session.worktree_path!, (e) => {
      const entry = registry.live.get(sessionId);
      if (e.type === "state" && entry) entry.state = e.state;
      if (e.type === "item" || e.type === "state") {
        onDriveMessage(sessionId, e, fx);
        if (opts.publish) publisher.onMessage(sessionId, e);
      }
      if (e.type === "queue")
        onDriveMessage(
          sessionId,
          { type: "queue", queue: listQueue(sessionId) },
          fx
        );
    });
    registry.live.set(sessionId, {
      worker: {
        command: (c: WorkerCommand) => {
          commands.push(c);
          void w.host.handle(c);
        },
      },
      state: "idle",
      streaming: new Map(),
      activity: null,
      canGuestGate: true,
    } as never);
    await open(sessionId, opts.level ?? "drive");
    admit(guestId, "Ahmed", opts.level !== "suggest");
    const prompt = async (
      id: string,
      text = "add a test for the parser",
      gid = guestId
    ) => {
      down({
        type: "drive_prompt",
        id,
        guest: { id: gid, name: "Ahmed" },
        text,
      });
      await settle();
    };
    const statuses = (id?: string) =>
      up("drive_status").filter((s) => !id || s.id === id);
    const sends = () => commands.filter((c) => c.type === "send");
    const done = () => {
      w.host.close();
      registry.live.delete(sessionId);
    };
    return {
      sessionId,
      w,
      commands,
      sends,
      prompt,
      statuses,
      done,
      rt: () => live.runtimes.get(SHARE)!,
    };
  }

  function reset() {
    for (const id of [...live.runtimes.keys()]) live.runtimes.delete(id);
    live.socket?.close();
    live.socket = svc.makeSocket(factory as never);
    fake = null;
    seen.length = 0;
    getDb().prepare(`DELETE FROM live_shares`).run();
    getDb().prepare(`DELETE FROM live_share_log`).run();
  }

  function close() {
    live.socket?.close();
    server.close();
  }

  return {
    live,
    svc,
    seen,
    down,
    up,
    taskChat,
    setColumns,
    open,
    driving,
    settle,
    admit,
    reset,
    close,
  };
}
