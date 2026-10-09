import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// tmux with an argument list, never a shell: a session name, a path or a
// message is always one argument.
export async function tmux(args: string[], timeout = 10_000): Promise<string> {
  const { stdout } = await execFileAsync("tmux", args, {
    timeout,
    maxBuffer: 8 << 20,
  });
  return stdout;
}

// Paste text through a named buffer (deleted after), fed on stdin: whatever
// the text holds, it reaches the pane as typed text.
export async function pasteText(
  target: string,
  text: string,
  buffer: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      "tmux",
      ["load-buffer", "-b", buffer, "-"],
      { timeout: 10_000 },
      (err) => (err ? reject(err) : resolve())
    );
    // tmux gone before it read everything is a failed paste, not a crash.
    child.stdin?.on("error", reject);
    child.stdin?.end(text);
  });
  await tmux(["paste-buffer", "-d", "-b", buffer, "-t", target]);
}
