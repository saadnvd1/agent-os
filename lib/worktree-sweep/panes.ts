import { execFile } from "child_process";

// The folders open in tmux panes, so a worktree someone has a terminal in is
// left alone. Empty when tmux isn't running or can't be read.
export function openPaneFolders(timeoutMs = 3000): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      "tmux",
      ["list-panes", "-a", "-F", "#{pane_current_path}"],
      { timeout: timeoutMs },
      (error, stdout) =>
        resolve(error ? [] : String(stdout).split("\n").filter(Boolean))
    );
  });
}

export const inFolder = (folder: string, root: string) =>
  folder === root || folder.startsWith(root + "/");
