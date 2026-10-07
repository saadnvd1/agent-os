import { randomUUID } from "crypto";
import { hostExec } from "../hosts";
import { shellQuote } from "../hosts/ssh";
import type { Pane, PaneView } from "./delivery";

const SEP = "\n@@aos-pane@@";

// A session's tmux pane, on whichever host it runs.
export function tmuxPane(hostId: string, tmuxName: string): Pane {
  const t = shellQuote(`=${tmuxName}:`);
  const run = (cmd: string) => hostExec(hostId, cmd);
  return {
    async view(): Promise<PaneView> {
      const { stdout } = await run(
        `tmux capture-pane -p -t ${t} && printf %s ${shellQuote(SEP)} && tmux display-message -p -t ${t} '#{cursor_y} #{pane_in_mode}'`
      );
      const at = stdout.lastIndexOf(SEP);
      const [y, mode] = stdout
        .slice(at + SEP.length)
        .trim()
        .split(" ");
      const cursorY = Number.parseInt(y, 10);
      return {
        text: stdout.slice(0, at),
        cursorY: Number.isFinite(cursorY) ? cursorY : null,
        inMode: mode === "1",
      };
    },
    async type(text) {
      await run(`tmux send-keys -t ${t} -l ${shellQuote(text)}`);
    },
    // A bracketed paste through a buffer of its own, deleted after.
    async paste(text) {
      const b = shellQuote(`aos-bus-${randomUUID().slice(0, 8)}`);
      await run(
        `printf %s ${shellQuote(text)} | tmux load-buffer -b ${b} - && tmux paste-buffer -p -d -b ${b} -t ${t}`
      );
    },
    async enter() {
      await run(`tmux send-keys -t ${t} Enter`);
    },
    async leaveMode() {
      await run(`tmux send-keys -t ${t} -X cancel`);
    },
  };
}
