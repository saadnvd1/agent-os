import { spawn, type ChildProcess } from "child_process";
import { pathFor, resolveCli } from "../../agents/cli-path";

// A record longer than this is dropped, not parsed: some agents resend the
// whole partial reply on every update.
const MAX_LINE = 8 * 1024 * 1024;
const STDERR_TAIL = 4000;

// A worker that exits takes its agents with it: one that doesn't read
// stdin (a server) would otherwise outlive it.
const live = new Set<AgentChild>();
let exitHook = false;
function onWorkerExit(): void {
  for (const child of live) child.kill();
}

export interface ChildOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  // Called with each JSON record on stdout; lines that aren't JSON are
  // skipped (an extension may print anything).
  onRecord?: (record: unknown) => void;
  onStdout?: (line: string) => void;
  onExit?: (code: number | null, error?: string) => void;
}

// An agent CLI run as a child process that speaks JSON lines on stdout. Its
// stderr is kept, briefly, for the error to show if it dies.
export class AgentChild {
  readonly proc: ChildProcess;
  private stderr = "";
  private exited = false;

  constructor(
    cli: string,
    args: string[],
    private options: ChildOptions
  ) {
    const bin = resolveCli(cli);
    if (!bin) throw new Error(`${cli} isn't installed on this machine`);
    this.proc = spawn(bin, args, {
      cwd: options.cwd,
      env: { ...options.env, PATH: pathFor(bin) },
      stdio: ["pipe", "pipe", "pipe"],
      // Its own process group, so stopping it stops what it started.
      detached: true,
    });
    let buf = "";
    this.proc.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        this.line(line);
      }
      if (buf.length > MAX_LINE) buf = "";
    });
    this.proc.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-STDERR_TAIL);
    });
    this.proc.stdin!.on("error", () => {});
    live.add(this);
    if (!exitHook) {
      exitHook = true;
      process.once("exit", onWorkerExit);
    }
    this.proc.on("error", (error) => this.exit(null, error.message));
    this.proc.on("exit", (code) => this.exit(code));
  }

  private line(line: string): void {
    if (!line.trim() || line.length > MAX_LINE) return;
    this.options.onStdout?.(line);
    if (!this.options.onRecord) return;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    this.options.onRecord(record);
  }

  private exit(code: number | null, error?: string): void {
    if (this.exited) return;
    this.exited = true;
    live.delete(this);
    this.options.onExit?.(code, error);
  }

  get alive(): boolean {
    return !this.exited;
  }

  // The last of what it wrote to stderr, on one line, for an error message.
  get errorTail(): string {
    return this.stderr.trim().split("\n").slice(-3).join(" ").slice(-500);
  }

  write(record: unknown): void {
    if (this.exited) return;
    this.proc.stdin!.write(`${JSON.stringify(record)}\n`);
  }

  // Asks it to stop, and makes sure a second later.
  kill(): void {
    if (this.exited || !this.proc.pid) return;
    const group = -this.proc.pid;
    try {
      process.kill(group, "SIGTERM");
    } catch {
      return;
    }
    setTimeout(() => {
      if (this.exited) return;
      try {
        process.kill(group, "SIGKILL");
      } catch {
        // Already gone.
      }
    }, 1000).unref();
  }
}
