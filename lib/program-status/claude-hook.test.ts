import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { OscScanner } from "./parse";

const SCRIPT = join(process.cwd(), "scripts", "claude-status-hook.sh");
let dir: string;
let tty: string;

// A fake tmux on PATH that names a plain file as the pane's tty.
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "osc7501-hook-"));
  tty = join(dir, "tty");
  writeFileSync(tty, "");
  writeFileSync(join(dir, "tmux"), `#!/bin/sh\necho ${JSON.stringify(tty)}\n`);
  chmodSync(join(dir, "tmux"), 0o755);
});

function run(event: string, input: object, env: Record<string, string> = {}) {
  const result = spawnSync("sh", [SCRIPT, event], {
    input: JSON.stringify(input),
    env: {
      NODE_ENV: "test",
      PATH: `${dir}:/usr/bin:/bin`,
      TMUX_PANE: "%1",
      ...env,
    },
    encoding: "utf-8",
  });
  const events = new OscScanner().push(readFileSync(tty).toString("latin1"));
  return { code: result.status, stdout: result.stdout, events };
}

const report = (r: ReturnType<typeof run>) =>
  r.events.length === 1 && r.events[0].type === "report"
    ? r.events[0].report
    : null;

describe("the Claude Code status hook", () => {
  it("reports working on a prompt and tool calls, done on Stop", () => {
    for (const event of ["UserPromptSubmit", "PreToolUse", "PostToolUse"]) {
      writeFileSync(tty, "");
      const r = run(event, { tool_name: "Bash" });
      expect(r.code).toBe(0);
      expect(r.stdout).toBe("");
      expect(report(r)).toEqual({
        state: "working",
        id: "",
        app: "claude-code",
      });
    }
    expect(report(run("Stop", {}))?.state).toBe("done");
    writeFileSync(tty, "");
    expect(report(run("SessionEnd", {}))?.state).toBe("clear");
  });

  it("reports a permission request as blocked, naming the tool", () => {
    expect(
      report(
        run("PermissionRequest", {
          tool_name: "Bash",
          tool_input: { tool_name: "not this" },
        })
      )
    ).toEqual({
      state: "blocked",
      id: "",
      kind: "permission",
      app: "claude-code",
      msg: "Allow Bash?",
    });
  });

  it("reports a question as blocked", () => {
    expect(
      report(run("PreToolUse", { tool_name: "AskUserQuestion" }))
    ).toMatchObject({
      state: "blocked",
      kind: "question",
    });
  });

  it("keeps a message with quotes and non-ASCII text whole, capped", () => {
    const message = `Pick "one" — ${"é".repeat(300)}`;
    const r = run("Notification", {
      notification_type: "elicitation_dialog",
      message,
    });
    const msg = report(r)?.msg ?? "";
    expect(msg.startsWith('Pick "one" — é')).toBe(true);
    expect(msg.length).toBeLessThanOrEqual(200);
    expect(msg).not.toMatch(/�/);
  });

  it("ignores the idle notification", () => {
    expect(
      run("Notification", { notification_type: "idle_prompt", message: "x" })
        .events
    ).toEqual([]);
  });

  it("exits 0 and writes nothing outside tmux, or when tmux fails", () => {
    const outside = spawnSync("sh", [SCRIPT, "Stop"], {
      input: "{}",
      env: { NODE_ENV: "test", PATH: `${dir}:/usr/bin:/bin` },
      encoding: "utf-8",
    });
    expect(outside.status).toBe(0);
    writeFileSync(join(dir, "tmux"), "#!/bin/sh\nexit 1\n");
    const r = run("Stop", {});
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.events).toEqual([]);
  });
});
