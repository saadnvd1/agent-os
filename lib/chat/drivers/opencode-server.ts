import net from "net";
import { randomBytes } from "crypto";
import { AgentChild } from "./child";

type P = Record<string, unknown>;

const READY_MS = 30_000;
const CALL_MS = 15_000;
const LISTENING = /server listening on\s+(https?:\/\/\S+)/i;

// A free port on loopback. OpenCode's own "--port 0" takes 4096 instead.
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

// One `opencode serve` for one conversation, on loopback behind a password
// only this process knows. It holds a shell and the folder's files, so
// nothing else may talk to it.
export class OpenCodeServer {
  private child!: AgentChild;
  private url = "";
  private auth: string;
  readonly ready: Promise<void>;
  private exitHandlers: ((error: string) => void)[] = [];

  constructor(
    private cwd: string,
    env: NodeJS.ProcessEnv
  ) {
    const password = randomBytes(24).toString("base64url");
    this.auth = `Basic ${Buffer.from(`opencode:${password}`, "utf8").toString("base64")}`;
    this.ready = freePort().then(
      (port) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("OpenCode's server didn't start")),
            READY_MS
          );
          this.child = new AgentChild(
            "opencode",
            ["serve", "--hostname=127.0.0.1", `--port=${port}`],
            {
              cwd,
              env: {
                ...env,
                OPENCODE_SERVER_PASSWORD: password,
                // Never replace the user's own config: their providers are in it.
                OPENCODE_CONFIG_CONTENT: env.OPENCODE_CONFIG_CONTENT ?? "{}",
              },
              onStdout: (line) => {
                const m = line.match(LISTENING);
                if (!m || this.url) return;
                this.url = m[1].replace(/\/$/, "");
                clearTimeout(timer);
                resolve();
              },
              onExit: (code, error) => {
                clearTimeout(timer);
                const why =
                  error ??
                  `OpenCode stopped (exit ${code ?? "signal"})${this.child.errorTail ? `: ${this.child.errorTail}` : ""}`;
                reject(new Error(why));
                for (const h of this.exitHandlers) h(why);
              },
            }
          );
        })
    );
  }

  onExit(handler: (error: string) => void): void {
    this.exitHandlers.push(handler);
  }

  private endpoint(path: string): string {
    const sep = path.includes("?") ? "&" : "?";
    return `${this.url}${path}${sep}directory=${encodeURIComponent(this.cwd)}`;
  }

  // One JSON call. Errors carry OpenCode's message, never the URL.
  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.ready;
    const res = await fetch(this.endpoint(path), {
      method,
      headers: {
        authorization: this.auth,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_MS),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T & P) : (undefined as T);
    if (!res.ok) {
      const d = (data ?? {}) as P;
      const message =
        ((d.data as P)?.message as string) ?? (d.message as string) ?? text;
      const error = new Error(`OpenCode: ${message || res.status}`);
      (error as Error & { status?: number }).status = res.status;
      throw error;
    }
    return data;
  }

  // The event stream for this folder, until the server stops or `signal`
  // aborts. Reconnects if the stream drops while the server runs.
  async events(onEvent: (e: P) => void, signal: AbortSignal): Promise<void> {
    await this.ready;
    while (!signal.aborted && this.child.alive) {
      try {
        const res = await fetch(this.endpoint("/event"), {
          headers: { authorization: this.auth, accept: "text/event-stream" },
          signal,
        });
        if (!res.ok || !res.body) throw new Error(`event stream ${res.status}`);
        const decoder = new TextDecoder();
        let buf = "";
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          buf += decoder.decode(chunk, { stream: true });
          let end: number;
          while ((end = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, end);
            buf = buf.slice(end + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            try {
              onEvent(JSON.parse(data) as P);
            } catch {
              // Not JSON: skipped.
            }
          }
        }
      } catch {
        if (signal.aborted) return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  close(): void {
    this.child?.kill();
  }
}
