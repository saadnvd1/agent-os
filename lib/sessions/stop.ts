import { endTmuxSession } from "../tmux/end";
import { hostLink } from "../hosts/remote-api";
import { stopChatTurn } from "../chat/stop";
import type { Session } from "../db";

// Stops a session's agent and keeps everything else, the same for every
// caller (the orchestrator's stop tool, `aos stop`): a chat's turn ends
// whatever it is doing, a terminal's tmux session ends. The worktree, branch
// and conversation stay, and the next message runs as the next turn. Throws
// when the chat can't be shown to have stopped.
export async function stopSession(
  s: Pick<Session, "id" | "name" | "view" | "host_id" | "tmux_name">
): Promise<string> {
  if (s.view === "chat") {
    if (hostLink(s.host_id))
      throw new Error(
        `Couldn't stop ${s.name}: it runs on another machine; stop it there.`
      );
    const out = await stopChatTurn(s.id);
    if (!out.stopped)
      throw new Error(`Couldn't stop ${s.name}: ${out.reason}.`);
    return out.killed
      ? `Stopped ${s.name}: its agent didn't answer the interrupt, so it was ended. Its conversation and worktree are kept; your next message runs as its next turn.`
      : `Stopped ${s.name}'s turn. Your next message runs as its next turn.`;
  }
  await endTmuxSession(s.host_id, s.tmux_name);
  return `Stopped ${s.name}: its agent is ended, its worktree and branch are kept.`;
}
