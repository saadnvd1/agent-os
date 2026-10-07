import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "claude-status-hook.sh");
const NOTE =
  '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"Note: load is red."}}';
let dir: string;

// A fake curl on PATH: records its stdin and arguments, then answers (or fails).
function fakeCurl(script: string) {
  writeFileSync(join(dir, "curl"), `#!/bin/sh\n${script}\n`);
  chmodSync(join(dir, "curl"), 0o755);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "load-hook-"));
});

function run(event: string, input: object) {
  const start = Date.now();
  const result = spawnSync("sh", [SCRIPT, event], {
    input: JSON.stringify(input),
    env: {
      NODE_ENV: "test",
      PATH: `${dir}:/usr/bin:/bin`,
      AGENTOS_URL: "http://127.0.0.1:1",
      AGENTOS_SESSION_ID: "abc",
    },
    encoding: "utf-8",
  });
  return { code: result.status, stdout: result.stdout, ms: Date.now() - start };
}

const heavy = { tool_name: "Bash", tool_input: { command: "npx vitest run" } };

describe("the hook's heavy-command note", () => {
  it("prints the server's note for a heavy Bash call", () => {
    fakeCurl(
      `cat > ${JSON.stringify(join(dir, "body"))}; echo "$@" > ${JSON.stringify(join(dir, "args"))}; printf '%s' '${NOTE}'`
    );
    const r = run("PreToolUse", heavy);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(NOTE);
    expect(JSON.parse(readFileSync(join(dir, "body"), "utf8"))).toEqual(heavy);
    expect(readFileSync(join(dir, "args"), "utf8")).toContain(
      "/api/load/hook?event=PreToolUse&session=abc"
    );
  });

  it("never asks the server about a light command", () => {
    fakeCurl(`touch ${JSON.stringify(join(dir, "called"))}`);
    const r = run("PreToolUse", {
      tool_name: "Bash",
      tool_input: { command: "git status" },
    });
    expect(r).toMatchObject({ code: 0, stdout: "" });
    expect(existsSync(join(dir, "called"))).toBe(false);
  });

  it("fails open: no server, a failing curl, or an error page", () => {
    expect(run("PreToolUse", heavy)).toMatchObject({ code: 0, stdout: "" });
    fakeCurl("exit 7");
    expect(run("PreToolUse", heavy)).toMatchObject({ code: 0, stdout: "" });
    fakeCurl("echo '<html>500</html>'");
    expect(run("PreToolUse", heavy)).toMatchObject({ code: 0, stdout: "" });
  });

  it("gives up on an unreachable server fast", () => {
    // Port 1 refuses; real curl is on /usr/bin.
    const r = run("PreToolUse", heavy);
    expect(r.code).toBe(0);
    expect(r.ms).toBeLessThan(1000);
  });
});
