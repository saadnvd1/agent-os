import { Terminal } from "@xterm/headless";

/**
 * A pane's visible screen, kept from its output (tmux control mode) so that
 * reading it costs no `tmux capture-pane`. It starts from one capture and is
 * trued up from another when output settles (lib/tmux/control.ts), since a
 * capture carries no cursor modes or scroll region and the copy can drift.
 */
export class PaneScreen {
  private term: Terminal;
  private title = "";

  constructor(cols: number, rows: number) {
    this.term = new Terminal({
      cols: Math.max(cols, 2),
      rows: Math.max(rows, 1),
      scrollback: 0,
      allowProposedApi: true,
    });
    this.term.onTitleChange((t) => (this.title = t));
  }

  /** Bytes the pane printed (raw, as latin1 code units). */
  write(latin1: string): void {
    this.term.write(Buffer.from(latin1, "latin1"));
  }

  /**
   * Starts over from a capture (`capture-pane -e -p`): its lines, the cursor
   * where tmux has it, the pane's size.
   */
  async reset(
    capture: string,
    cols: number,
    rows: number,
    cursor: { x: number; y: number }
  ): Promise<void> {
    // Output already handed to the parser lands before the reset, not after.
    await this.settled();
    this.term.reset();
    if (cols !== this.term.cols || rows !== this.term.rows)
      this.term.resize(Math.max(cols, 2), Math.max(rows, 1));
    const lines = capture.replace(/\n$/, "").split("\n").slice(0, rows);
    const body = lines.join("\r\n");
    await new Promise<void>((resolve) =>
      this.term.write(
        `${body}\x1b[0m\x1b[${cursor.y + 1};${cursor.x + 1}H`,
        resolve
      )
    );
  }

  /** Writes still being parsed are applied first. */
  settled(): Promise<void> {
    return new Promise((resolve) => this.term.write("", resolve));
  }

  get cols(): number {
    return this.term.cols;
  }

  get rows(): number {
    return this.term.rows;
  }

  windowTitle(): string {
    return this.title;
  }

  /**
   * The screen as `capture-pane -e -p` would print it for what's read from
   * it: one line per row, trailing blanks trimmed, and dim text marked with
   * SGR 2/22 (placeholders and suggestions are drawn dim).
   */
  text(): string {
    const buffer = this.term.buffer.active;
    const out: string[] = [];
    const cell = buffer.getNullCell();
    for (let y = 0; y < this.term.rows; y++) {
      const line = buffer.getLine(buffer.viewportY + y);
      if (!line) {
        out.push("");
        continue;
      }
      let row = "";
      let dim = false;
      let pendingSpaces = "";
      for (let x = 0; x < this.term.cols; x++) {
        line.getCell(x, cell);
        if (cell.getWidth() === 0) continue;
        const chars = cell.getChars() || " ";
        const isDim = !!cell.isDim();
        if (chars === " " && !isDim) {
          pendingSpaces += " ";
          continue;
        }
        row += pendingSpaces;
        pendingSpaces = "";
        if (isDim !== dim) {
          row += isDim ? "\x1b[2m" : "\x1b[22m";
          dim = isDim;
        }
        row += chars;
      }
      if (dim) row += "\x1b[22m";
      out.push(row);
    }
    while (out.length && out[out.length - 1] === "") out.pop();
    return out.join("\n");
  }

  dispose(): void {
    this.term.dispose();
  }
}
