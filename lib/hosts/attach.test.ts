import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildAttachProcess, buildTmuxAttachCommand } from "./attach";

describe("buildTmuxAttachCommand", () => {
  it("creates or attaches in one step and expands ~ on the target", () => {
    assert.equal(
      buildTmuxAttachCommand({ sessionName: "claude-1", cwd: "~/dev/app" }),
      `tmux start-server \\; set -g mouse on \\; new-session -A -s claude-1 -c "$HOME"'/dev/app'`
    );
  });

  it("quotes the agent command", () => {
    assert.match(
      buildTmuxAttachCommand({ sessionName: "s", command: "claude --x 'y'" }),
      /'claude --x '\\''y'\\'''/
    );
  });

  it("reattaches by exact name without creating", () => {
    assert.equal(
      buildTmuxAttachCommand({ sessionName: "s", attachOnly: true }),
      `tmux start-server \\; set -g mouse on \\; attach-session -t '=s'`
    );
  });

  it("rejects names that could inject arguments", () => {
    assert.throws(() => buildTmuxAttachCommand({ sessionName: "a;rm -rf" }));
  });
});

describe("buildAttachProcess", () => {
  it("runs tmux through a local login shell", () => {
    const p = buildAttachProcess({ sessionName: "s" }, null, "/bin/zsh");
    assert.equal(p.file, "/bin/zsh");
    assert.equal(p.args[0], "-lc");
  });

  it("runs tmux over ssh with a tty for remote hosts", () => {
    const p = buildAttachProcess({ sessionName: "s" }, "me@box", "/bin/zsh");
    assert.equal(p.file, "ssh");
    assert.ok(p.args.includes("-t"));
    assert.equal(p.args.at(-2), "me@box");
  });
});
