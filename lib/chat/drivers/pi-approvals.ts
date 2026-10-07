import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import type { ChatAccess, DriverEvent } from "../events";
import { PendingApprovals } from "./pending-approvals";
import { piTool } from "./pi-mapper";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

const DIR = path.join(os.homedir(), ".agent-os", "pi");
const MARK = "agentos:";

// Pi runs every tool without asking. This extension asks the chat first,
// as the conversation's access setting says, read from a file each time so
// a change applies to the very next call. Reading never asks. Exported for
// its test.
export const EXTENSION = `import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
const SAFE = new Set(["read", "grep", "find", "ls"]);
// A path with its links resolved, as far as it exists, in the case the
// disk stores it (macOS matches names in any case).
function real(p) {
  try {
    return realpathSync.native(p);
  } catch {
    const up = dirname(p);
    return up === p ? p : resolve(real(up), basename(p));
  }
}
const fold = (p) => (process.platform === "darwin" ? p.toLowerCase() : p);
const inside = (p, root) => {
  const [a, b] = [fold(p), fold(root)];
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
};
// "Accept edits" covers the conversation's own folder, never AgentOS's
// files (this gate's access setting among them) nor Pi's own (.pi holds
// extensions Pi runs on its next start).
function ownEdit(input) {
  const accessFile = process.env.AGENTOS_PI_ACCESS_FILE;
  if (!accessFile || typeof input?.path !== "string") return false;
  const target = real(resolve(process.cwd(), input.path));
  const parts = fold(target).split(sep);
  return (
    inside(target, real(process.cwd())) &&
    !inside(target, real(dirname(accessFile))) &&
    !parts.includes(".pi")
  );
}
export default function (pi) {
  pi.on("tool_call", async (event, ctx) => {
    // Unreadable or unknown asks: the gate never fails open.
    let access = "ask";
    try {
      const value = readFileSync(process.env.AGENTOS_PI_ACCESS_FILE, "utf8").trim();
      if (value === "full" || value === "edits") access = value;
    } catch {}
    const tool = event.toolName;
    if (access === "full" || SAFE.has(tool)) return;
    if (access === "edits" && (tool === "edit" || tool === "write") && ownEdit(event.input)) return;
    const ok = await ctx.ui.confirm(
      "${MARK}" + event.toolCallId,
      JSON.stringify({ tool, input: event.input })
    );
    if (!ok) return { block: true, reason: "The user declined " + tool + "." };
  });
}
`;

// Owner-only: the access settings in it are what the gate trusts.
function ensureDir(): void {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(DIR, 0o700);
}

export function writeExtension(): string {
  ensureDir();
  const file = path.join(DIR, "agentos-approvals.mjs");
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== EXTENSION)
    fs.writeFileSync(file, EXTENSION);
  return file;
}

// The conversation's access setting, where the extension reads it.
export class PiAccess {
  readonly file = path.join(DIR, `${randomUUID()}.access`);

  constructor(access: ChatAccess) {
    this.set(access);
  }

  set(access: ChatAccess): void {
    ensureDir();
    fs.writeFileSync(this.file, access, { mode: 0o600 });
  }

  remove(): void {
    fs.rmSync(this.file, { force: true });
  }
}

// Pi's dialogs (the extension's approvals, and any other extension's
// confirm or select) as chat cards.
export class PiDialogs {
  readonly pending: PendingApprovals;
  // Tools allowed for the rest of the conversation.
  private always = new Set<string>();

  constructor(emit: (e: DriverEvent) => void) {
    this.pending = new PendingApprovals(emit);
  }

  // The answer to send back, or null for a request that wants none.
  async handle(r: P): Promise<P | null> {
    const id = str(r.id);
    if (r.method === "confirm") {
      const title = str(r.title);
      if (title.startsWith(MARK)) return this.approval(title, str(r.message));
      const o = await this.pending.ask({
        id: `approval-${id}`,
        toolName: "Confirm",
        title: title || "Confirm",
        input: { message: r.message },
        canAlways: false,
      });
      return { confirmed: o.decision === "allow" };
    }
    if (r.method === "select") {
      const question = str(r.title) || "Choose one";
      const o = await this.pending.ask({
        id: `approval-${id}`,
        toolName: "AskUserQuestion",
        title: question,
        input: {},
        questions: [
          {
            question,
            header: "",
            multiSelect: false,
            options: ((r.options as unknown[]) ?? []).map((o) => ({
              label: String(o),
              description: "",
            })),
          },
        ],
        canAlways: false,
      });
      return o.decision === "answer"
        ? { value: o.answers[question] }
        : { cancelled: true };
    }
    if (r.method === "input" || r.method === "editor")
      return { cancelled: true };
    return null;
  }

  private async approval(title: string, message: string): Promise<P> {
    let call: { tool?: string; input?: unknown } = {};
    try {
      call = JSON.parse(message);
    } catch {
      // Shown as an unknown tool.
    }
    const tool = call.tool ?? "tool";
    if (this.always.has(tool)) return { confirmed: true };
    const start = piTool(tool, call.input);
    const o = await this.pending.ask({
      id: `approval-${title.slice(MARK.length)}`,
      toolName: start.name,
      title: start.title,
      input: start.input,
      diff: start.diff,
      canAlways: true,
    });
    if (o.decision === "always") this.always.add(tool);
    return { confirmed: o.decision === "allow" || o.decision === "always" };
  }
}
