// The mouse modes a program turned on, read from its raw output. The headless
// screen a replay is drawn from doesn't track them, so without this a viewer
// that joins late gets no mouse reporting and tmux never sees the wheel.
const TRACKING = ["1000", "1002", "1003"];
const ENCODING = ["1005", "1006", "1015"];
const DECSET = /\x1b\[\?([\d;]+)([hl])/g;

export class MouseModes {
  private tracking: string | null = null;
  private encoding: string | null = null;
  // A sequence split across two chunks: the start of it, kept for the next.
  private tail = "";

  feed(data: string): void {
    const text = this.tail + data;
    const cut = text.lastIndexOf("\x1b");
    this.tail =
      cut >= 0 && cut > text.length - 16 && !/[hl]/.test(text.slice(cut + 1))
        ? text.slice(cut)
        : "";
    for (const [, params, op] of text.matchAll(DECSET)) {
      for (const p of params.split(";")) {
        if (TRACKING.includes(p)) this.tracking = op === "h" ? p : null;
        if (ENCODING.includes(p)) this.encoding = op === "h" ? p : null;
      }
    }
  }

  // Sequences that put a fresh terminal in the same mouse state.
  restore(): string {
    let out = "";
    if (this.tracking) out += `\x1b[?${this.tracking}h`;
    if (this.encoding) out += `\x1b[?${this.encoding}h`;
    return out;
  }
}
