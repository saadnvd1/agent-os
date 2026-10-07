import { AgentChild } from "./child";

export interface CodexMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

const REQUEST_MS = 60_000;

// Codex's app server: JSON-RPC (without the "jsonrpc" field) over the
// stdio of `codex app-server`. Its own requests to us (approvals) count
// their ids separately from ours.
export class CodexRpc {
  private child: AgentChild;
  private nextId = 1;
  private calls = new Map<
    number,
    { resolve: (r: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(
    options: { cwd: string; env: NodeJS.ProcessEnv },
    handlers: {
      notify: (method: string, params: Record<string, unknown>) => void;
      request: (
        id: number | string,
        method: string,
        params: Record<string, unknown>
      ) => void;
      exit: (error: string) => void;
    }
  ) {
    this.child = new AgentChild("codex", ["app-server"], {
      ...options,
      onRecord: (r) => {
        const m = r as CodexMessage;
        if (m.method && m.id !== undefined)
          handlers.request(m.id, m.method, m.params ?? {});
        else if (m.method) handlers.notify(m.method, m.params ?? {});
        else if (typeof m.id === "number") this.settle(m);
      },
      onExit: (code, error) => {
        const why =
          error ??
          `Codex stopped (exit ${code ?? "signal"})${this.child.errorTail ? `: ${this.child.errorTail}` : ""}`;
        for (const call of this.calls.values()) call.reject(new Error(why));
        this.calls.clear();
        handlers.exit(why);
      },
    });
  }

  private settle(m: CodexMessage): void {
    const call = this.calls.get(m.id as number);
    if (!call) return;
    this.calls.delete(m.id as number);
    if (m.error) call.reject(new Error(m.error.message ?? "Codex error"));
    else call.resolve(m.result);
  }

  request<T>(method: string, params: unknown = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`Codex didn't answer ${method}`));
      }, REQUEST_MS);
      this.calls.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.child.write(params === undefined ? { method } : { method, params });
  }

  reply(id: number | string, result: unknown): void {
    this.child.write({ id, result });
  }

  replyError(id: number | string, message: string): void {
    this.child.write({ id, error: { code: -32601, message } });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      clientInfo: { name: "agentos", title: "AgentOS", version: "1.0.0" },
      capabilities: {
        experimentalApi: false,
        optOutNotificationMethods: ["turn/diff/updated"],
      },
    }).catch((e: Error) => {
      if (!/already initialized/i.test(e.message)) throw e;
    });
    this.notify("initialized");
  }

  close(): void {
    this.child.kill();
  }
}
