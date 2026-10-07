import { randomUUID } from "crypto";
import { AgentChild } from "./child";

type P = Record<string, unknown>;

const REQUEST_MS = 30_000;

// Pi's RPC mode: JSON commands on stdin, each answered by a response with
// the same id, and the session's events on stdout. Commands are handled
// concurrently, so responses can come in any order.
export class PiRpc {
  private child: AgentChild;
  private calls = new Map<
    string,
    { resolve: (d: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv },
    handlers: {
      event: (e: P) => void;
      ui: (request: P) => void;
      exit: (error: string) => void;
    }
  ) {
    this.child = new AgentChild("pi", ["--mode", "rpc", ...args], {
      ...options,
      onRecord: (r) => {
        const m = r as P;
        if (m.type === "response") this.settle(m);
        else if (m.type === "extension_ui_request") handlers.ui(m);
        else handlers.event(m);
      },
      onExit: (code, error) => {
        const why =
          error ??
          `Pi stopped (exit ${code ?? "signal"})${this.child.errorTail ? `: ${this.child.errorTail}` : ""}`;
        for (const call of this.calls.values()) call.reject(new Error(why));
        this.calls.clear();
        handlers.exit(why);
      },
    });
  }

  private settle(m: P): void {
    const call = typeof m.id === "string" ? this.calls.get(m.id) : undefined;
    if (!call) return;
    this.calls.delete(m.id as string);
    if (m.success === false)
      call.reject(new Error(String(m.error ?? "Pi refused the command")));
    else call.resolve(m.data);
  }

  // Sends a command; resolves with its response's data. A timeout of 0
  // waits as long as it takes (abort answers once the turn has stopped).
  request<T>(type: string, params: P = {}, timeoutMs = REQUEST_MS): Promise<T> {
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.calls.delete(id);
            reject(new Error(`Pi didn't answer ${type}`));
          }, timeoutMs)
        : undefined;
      this.calls.set(id, {
        resolve: (d) => {
          clearTimeout(timer);
          resolve(d as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.child.write({ id, type, ...params });
    });
  }

  answerUi(id: string, answer: P): void {
    this.child.write({ type: "extension_ui_response", id, ...answer });
  }

  close(): void {
    this.child.kill();
  }
}
