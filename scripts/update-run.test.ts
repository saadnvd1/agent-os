import { execFile, execFileSync } from "child_process";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import path from "path";
import { promisify } from "util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

const exec = promisify(execFile);
const runner = path.join(__dirname, "update-run.mjs");

let dir: string;
beforeEach(() => {
  dir = tempDir("aos-runner-");
  fs.writeFileSync(
    path.join(dir, "state.json"),
    JSON.stringify({ id: "r1", phase: "starting", from: "a" })
  );
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const go = async (
  script: string,
  restart?: string,
  extra: Record<string, string> = {}
) => {
  const redeploy = path.join(dir, "redeploy");
  fs.writeFileSync(redeploy, `#!/usr/bin/env bash\n${script}\n`, {
    mode: 0o755,
  });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AGENTOS_UPDATE_STATE: path.join(dir, "state.json"),
    AGENTOS_UPDATE_REDEPLOY: redeploy,
    // Never the real checkout: a failed run resets the source.
    AGENTOS_UPDATE_ROOT: dir,
    AGENTOS_UPDATE_VERIFY: "0",
  };
  delete env.AGENTOS_UPDATE_DB;
  delete env.AGENTOS_UPDATE_TO;
  delete env.PORT;
  Object.assign(env, extra);
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

// A stand-in for the restarted server: its build comes from a file the fake
// redeploy writes, and its startedAt can be made to change (a crash loop).
async function fakeServer(opts: { restarts?: boolean } = {}) {
  let n = 0;
  const server = http.createServer((req, res) => {
    const build = fs.readFileSync(path.join(dir, "build"), "utf8").trim();
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/updates/health")
      return res.end(
        JSON.stringify({
          ok: true,
          build,
          startedAt: opts.restarts ? `s${n++}` : "s",
          migrations: { known: 3, applied: 3 },
        })
      );
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    port: String((server.address() as AddressInfo).port),
    close: () => new Promise((r) => server.close(r)),
  };
}

const verifying = (port: string, to: string): Record<string, string> => ({
  AGENTOS_UPDATE_VERIFY: "1",
  AGENTOS_UPDATE_TO: to,
  PORT: port,
  AGENTOS_VERIFY_UP_MS: "300",
  AGENTOS_VERIFY_EVERY_MS: "20",
  AGENTOS_VERIFY_CHECKS: "2",
});

// Updates to "new"; a rollback writes "a" (the run's from) as the build.
const REDEPLOY = `
if [ "$1" = --rollback ]; then
  echo "$*" > "${"$"}AGENTOS_UPDATE_ROOT/rolled"
  [ -f "${"$"}AGENTOS_UPDATE_ROOT/rollback-works" ] && echo a > "${"$"}AGENTOS_UPDATE_ROOT/build"
  echo "::stage build_swapped"
  exit 0
fi
echo "::stage build_swapped"
cat "${"$"}AGENTOS_UPDATE_ROOT/next-build" > "${"$"}AGENTOS_UPDATE_ROOT/build"
`;

describe("scripts/update-run.mjs checks the new server", () => {
  const rolled = () =>
    fs.existsSync(path.join(dir, "rolled"))
      ? fs.readFileSync(path.join(dir, "rolled"), "utf8").trim()
      : null;

  it("a healthy server on the new build finishes done", async () => {
    fs.writeFileSync(path.join(dir, "next-build"), "new");
    const srv = await fakeServer();
    try {
      const s = await go(REDEPLOY, "x", verifying(srv.port, "new"));
      expect(s).toMatchObject({ phase: "done", outcome: "done" });
      expect(rolled()).toBeNull();
    } finally {
      await srv.close();
    }
  });

  it("a server on the wrong build is rolled back to where it was", async () => {
    fs.writeFileSync(path.join(dir, "next-build"), "stale");
    fs.writeFileSync(path.join(dir, "rollback-works"), "");
    const srv = await fakeServer();
    try {
      const s = await go(REDEPLOY, "x", verifying(srv.port, "new"));
      expect(s).toMatchObject({ phase: "rolled_back", outcome: "rolled_back" });
      expect(s.error).toContain("stale");
      expect(rolled()).toBe("--rollback --to a");
    } finally {
      await srv.close();
    }
  });

  it("a crash loop (startedAt changing) is rolled back, and ends broken when the old build loops too", async () => {
    fs.writeFileSync(path.join(dir, "next-build"), "new");
    fs.writeFileSync(path.join(dir, "rollback-works"), "");
    const srv = await fakeServer({ restarts: true });
    try {
      const s = await go(REDEPLOY, "x", {
        ...verifying(srv.port, "new"),
      });
      expect(s.outcome).toBe("broken");
      expect(s.error).toContain("crash loop");
      expect(rolled()).toBe("--rollback --to a");
    } finally {
      await srv.close();
    }
  });

  it("when the rollback doesn't come up either, it ends broken", async () => {
    fs.writeFileSync(path.join(dir, "next-build"), "stale");
    const srv = await fakeServer();
    try {
      const s = await go(REDEPLOY, "x", verifying(srv.port, "new"));
      expect(s).toMatchObject({ phase: "failed", outcome: "broken" });
    } finally {
      await srv.close();
    }
  });

  it("a server that never came back after the restart is rolled back", async () => {
    fs.writeFileSync(path.join(dir, "rollback-works"), "");
    const s = await go(
      'if [ "$1" = --rollback ]; then echo "$*" > "$AGENTOS_UPDATE_ROOT/rolled"; exit 0; fi\necho "::stage build_swapped"\nexit 1',
      "x"
    );
    expect(s).toMatchObject({ phase: "rolled_back", outcome: "rolled_back" });
    expect(rolled()).toBe("--rollback --to a");
  });
});

describe("scripts/update-run.mjs before the swap", () => {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();

  it("a failed build after the pull puts the source back and records build_failed", async () => {
    git("init", "-q");
    git(
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "one"
    );
    const from = git("rev-parse", "HEAD");
    git(
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "two"
    );
    fs.writeFileSync(
      path.join(dir, "state.json"),
      JSON.stringify({ id: "r1", phase: "starting", from })
    );
    const s = await go('echo "::stage pulled"\nexit 1', "x");
    expect(s).toMatchObject({ phase: "failed", outcome: "build_failed" });
    expect(git("rev-parse", "HEAD")).toBe(from);
    expect(s.stage).toBe("pulled");
  });

  it("a failure before the pull leaves the source alone", async () => {
    const s = await go("exit 1", "x");
    expect(s.outcome).toBe("build_failed");
    expect(s.log.join("\n")).not.toContain("Put the source back");
  });

  it("backs the database up first and keeps the last three", async () => {
    fs.symlinkSync(
      path.resolve(__dirname, "../node_modules"),
      path.join(dir, "node_modules")
    );
    const { default: Sqlite } = await import("better-sqlite3");
    const db = new Sqlite(path.join(dir, "live.db"));
    db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (42)");
    db.close();
    const backups = path.join(dir, "backups");
    fs.mkdirSync(backups);
    for (const d of ["20200101T000000", "20200102T000000", "20200103T000000"])
      fs.writeFileSync(path.join(backups, `agent-os-${d}-update-a.db`), "");
    const s = await go("echo ok", undefined, {
      AGENTOS_UPDATE_DB: path.join(dir, "live.db"),
      AGENTOS_UPDATE_BACKUPS: backups,
    });
    expect(s.phase).toBe("built");
    const files = fs.readdirSync(backups).sort();
    expect(files).toHaveLength(3);
    const copy = new Sqlite(path.join(backups, files[2]), { readonly: true });
    expect(copy.prepare("SELECT x FROM t").get()).toEqual({ x: 42 });
    copy.close();
  });

  it("writes its pid and a heartbeat", async () => {
    const s = await go("echo ok");
    expect(s.pid).toBeTypeOf("number");
    expect(s.updatedAt).toBeTypeOf("number");
  });
});
