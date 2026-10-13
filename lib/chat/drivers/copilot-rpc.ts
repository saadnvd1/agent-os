import { AgentChild } from "./child";

export interface AcpMessage {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string };
}

const REQUEST_MS = 60_000;

// The GitHub Copilot CLI as an Agent Client Protocol server: JSON-RPC 2.0
// over the stdio of `copilot --acp`. Its own requests to us (permission
// prompts) count their ids separately from ours.
export class CopilotRpc {
  private child: AgentChild;
  private nextId = 1;
  private calls = new Map<
    number,
    { resolve: (r: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(
    args: string[],
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
    this.child = new AgentChild(
      "copilot",
      ["--acp", "--no-auto-update", ...args],
      {
        ...options,
        onRecord: (r) => {
          const m = r as AcpMessage;
          if (m.method && m.id !== undefined)
            handlers.request(m.id, m.method, m.params ?? {});
          else if (m.method) handlers.notify(m.method, m.params ?? {});
          else if (typeof m.id === "number") this.settle(m);
        },
        onExit: (code, error) => {
          const why =
            error ??
            `GitHub Copilot stopped (exit ${code ?? "signal"})${this.child.errorTail ? `: ${this.child.errorTail}` : ""}`;
          for (const call of this.calls.values()) call.reject(new Error(why));
          this.calls.clear();
          handlers.exit(why);
        },
      }
    );
  }

  private settle(m: AcpMessage): void {
    const call = this.calls.get(m.id as number);
    if (!call) return;
    this.calls.delete(m.id as number);
    if (m.error)
      call.reject(new Error(m.error.message ?? "GitHub Copilot error"));
    else call.resolve(m.result);
  }

  // A timeout of 0 waits as long as it takes (a prompt runs a whole turn).
  request<T>(
    method: string,
    params: unknown = {},
    timeoutMs = REQUEST_MS
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.calls.delete(id);
            reject(new Error(`GitHub Copilot didn't answer ${method}`));
          }, timeoutMs)
        : undefined;
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
      this.child.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.child.write({ jsonrpc: "2.0", method, params });
  }

  reply(id: number | string, result: unknown): void {
    this.child.write({ jsonrpc: "2.0", id, result });
  }

  replyError(id: number | string, message: string): void {
    this.child.write({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message },
    });
  }

  // No file or terminal access offered: the agent uses its own.
  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "agentos", title: "AgentOS", version: "1.0.0" },
    });
  }

  close(): void {
    this.child.kill();
  }
}
