import fs from "fs";
import { envPath } from "./protocol";

// The server's environment, handed over in a private file rather than on
// the tmux command line. Without tmux's own: the pane exports the
// chat-worker server's socket as TMUX, and a tmux command the agent runs
// reaches it before TMUX_TMPDIR or -L, so a dev instance's `tmux
// kill-server` ended every chat worker (2026-10-10). Every driver passes
// process.env on to its agent, and the agent to its shells.
export function adoptServerEnv(
  sessionId: string,
  env: Record<string, string | undefined> = process.env
): void {
  const file = envPath(sessionId);
  if (fs.existsSync(file)) {
    Object.assign(env, JSON.parse(fs.readFileSync(file, "utf8")));
    fs.rmSync(file, { force: true });
  }
  delete env.TMUX;
  delete env.TMUX_PANE;
}
