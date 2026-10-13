import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const runner = path.join(__dirname, "update-run.mjs");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-runner-"));
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify({ id: "r1", phase: "starting", from: "a" })
  );
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const go = async (script: string, restart?: string) => {
  const redeploy = path.join(dir, "redeploy");
  fs.writeFileSync(redeploy, `#!/usr/bin/env bash\n${script}\n`, {
    mode: 0o755,
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTOS_UPDATE_STATE: path.join(dir, "state.json"),
    AGENTOS_UPDATE_REDEPLOY: redeploy,
  };
  if (restart) env.AGENTOS_RESTART = restart;
  else delete env.AGENTOS_RESTART;
  await exec(process.execPath, [runner], { env }).catch(() => {});
  return JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"));
};

describe("scripts/update-run.mjs", () => {
  it("finishes done after a restart command, keeping the id and the log", async () => {
    const s = await go(
      'echo "::phase pulling"\necho hello\necho "::phase restarting"',
      "x"
    );
    expect(s).toMatchObject({ id: "r1", phase: "done", from: "a" });
    expect(s.log).toEqual(["hello"]);
    expect(s.finishedAt).toBeTypeOf("number");
  });

  it("finishes built when there was nothing to restart with", async () => {
    expect((await go("echo ok")).phase).toBe("built");
  });

  it("fails with the last lines of output when redeploy fails", async () => {
    const s = await go("echo boom >&2\nexit 3");
    expect(s.phase).toBe("failed");
    expect(s.error).toContain("exit 3");
    expect(s.log).toContain("boom");
  });

  it("keeps only the last 30 lines", async () => {
    const s = await go("for i in $(seq 1 50); do echo line$i; done\nexit 1");
    expect(s.log).toHaveLength(30);
    expect(s.log.at(-1)).toBe("line50");
  });
});
