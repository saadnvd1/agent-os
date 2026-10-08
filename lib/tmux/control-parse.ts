// tmux control mode (`tmux -C`) speaks in lines. The ones read here:
//   %output %<pane> <bytes>      a pane printed; bytes below 32 and "\" are
//                                 written as \ooo octal, the rest as-is
//   %exit [reason]               the client is going away
//   %sessions-changed            a session was created or destroyed
//   %layout-change ...           a window's size or panes changed
// Command replies come between %begin and %end (or %error); they're only
// needed to tell them apart from notifications.

export type ControlLine =
  | { type: "output"; pane: string; data: string }
  | { type: "exit"; reason: string }
  | { type: "sessions-changed" }
  | { type: "layout-change" }
  // The session's active pane or window changed: what's watched moved.
  | { type: "pane-changed" }
  // `id`: the block's "<time> <number>", which its end repeats.
  | { type: "begin"; id: string; ours: boolean }
  | { type: "end"; id: string; error: boolean }
  | { type: "other" };

/** \ooo octal and \\ back to the bytes, as a latin1 string. */
export function decodeOutput(escaped: string): string {
  if (!escaped.includes("\\")) return escaped;
  return escaped.replace(/\\([0-7]{3}|\\)/g, (_, code: string) =>
    code === "\\" ? "\\" : String.fromCharCode(parseInt(code, 8))
  );
}

export function parseControlLine(line: string): ControlLine {
  if (line.startsWith("%output ")) {
    const space = line.indexOf(" ", 8);
    if (space === -1) return { type: "other" };
    return {
      type: "output",
      pane: line.slice(8, space),
      data: decodeOutput(line.slice(space + 1)),
    };
  }
  if (line === "%exit" || line.startsWith("%exit "))
    return { type: "exit", reason: line.slice(6) };
  if (line === "%sessions-changed") return { type: "sessions-changed" };
  if (line.startsWith("%layout-change ")) return { type: "layout-change" };
  if (
    line.startsWith("%window-pane-changed ") ||
    line.startsWith("%session-window-changed ")
  )
    return { type: "pane-changed" };
  const block = /^%(begin|end|error) (\d+ \d+) (\d+)$/.exec(line);
  if (block) {
    const [, kind, id, flags] = block;
    return kind === "begin"
      ? { type: "begin", id, ours: flags === "1" }
      : { type: "end", id, error: kind === "error" };
  }
  return { type: "other" };
}

/**
 * Splits a byte stream into lines (latin1, so a pane's raw UTF-8 bytes pass
 * through unchanged). A line longer than `max` is dropped rather than held.
 */
export class LineSplitter {
  private rest = "";
  private dropping = false;

  constructor(private readonly max = 4 * 1024 * 1024) {}

  push(chunk: Buffer): string[] {
    const text = this.rest + chunk.toString("latin1");
    const lines = text.split("\n");
    this.rest = lines.pop() ?? "";
    if (this.dropping && lines.length) {
      lines.shift();
      this.dropping = false;
    }
    if (this.rest.length > this.max) {
      this.rest = "";
      this.dropping = true;
    }
    return lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  }
}
