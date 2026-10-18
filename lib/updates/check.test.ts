import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHECK_EVERY_MS,
  checkForUpdate,
  compareUrl,
  resetCheckCache,
  updateChecksEnabled,
  type CheckDeps,
  type CheckResult,
} from "./check";
import { tempDir } from "@/lib/test-temp";

const sh = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))
      ) as NodeJS.ProcessEnv),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "a",
      GIT_AUTHOR_EMAIL: "a@example.com",
      GIT_COMMITTER_NAME: "a",
      GIT_COMMITTER_EMAIL: "a@example.com",
    },
  });

let tmp: string;
let origin: string;
let pusher: string;
let install: string;
let n = 0;
const commit = (dir: string, subject: string) => {
  fs.writeFileSync(path.join(dir, "f.txt"), `${++n}`);
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", subject);
};

let now = 1_000_000;
let saved: CheckResult | null = null;
let gitCalls: string[][] = [];
const deps = (cwd = install): CheckDeps => ({
  git: async (args) => {
    gitCalls.push(args);
    return sh(cwd, ...args);
  },
  now: () => now,
  load: () => saved,
  save: (r) => {
    saved = r;
  },
});

beforeEach(() => {
  resetCheckCache();
  saved = null;
  gitCalls = [];
  now = 1_000_000;
  tmp = tempDir("aos-upd-");
  origin = path.join(tmp, "origin.git");
  pusher = path.join(tmp, "pusher");
  install = path.join(tmp, "install");
  sh(tmp, "init", "-q", "--bare", "-b", "main", origin);
  sh(tmp, "clone", "-q", origin, pusher);
  sh(pusher, "checkout", "-q", "-b", "main");
  fs.writeFileSync(
    path.join(pusher, "package.json"),
    JSON.stringify({ version: "0.3.1" })
  );
  commit(pusher, "first");
  sh(pusher, "push", "-q", "-u", "origin", "main");
  sh(tmp, "clone", "-q", origin, install);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("checkForUpdate", () => {
  it("is up to date when the remote has nothing new", async () => {
    const { result } = await checkForUpdate({}, deps());
    expect(result).toMatchObject({ status: "ok", available: false, behind: 0 });
    expect(result.current?.version).toBe("0.3.1");
  });

  it("finds newer commits, with the latest version and what's new", async () => {
    for (let i = 1; i <= 10; i++) commit(pusher, `change ${i} (#${i})`);
    sh(pusher, "push", "-q", "origin", "main");
    const { result } = await checkForUpdate({}, deps());
    expect(result).toMatchObject({ status: "ok", available: true, behind: 10 });
    expect(result.current?.version).toBe("0.3.1");
    expect(result.latest?.version).toBe("0.3.11");
    // Newest first, capped.
    expect(result.latest?.notes).toHaveLength(8);
    expect(result.latest?.notes[0]).toBe("change 10 (#10)");
    expect(result.latest?.url).toBeNull();
  });

  it("is diverged, with no update offered, when the checkout has its own commits", async () => {
    commit(install, "local only");
    commit(pusher, "remote only");
    sh(pusher, "push", "-q", "origin", "main");
    const { result } = await checkForUpdate({}, deps());
    expect(result).toMatchObject({ status: "diverged", available: false });
  });

  it("is not an update when the checkout is ahead of the remote", async () => {
    commit(install, "local only");
    const { result } = await checkForUpdate({}, deps());
    expect(result).toMatchObject({ status: "ok", available: false, behind: 0 });
  });

  it("says unknown, with the error, outside a git checkout", async () => {
    const plain = tempDir("aos-plain-");
    try {
      const { result } = await checkForUpdate({}, deps(plain));
      expect(result.status).toBe("unknown");
      expect(result.error).toBeTruthy();
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it("doesn't fetch again inside six hours, and does after", async () => {
    await checkForUpdate({}, deps());
    gitCalls = [];
    await checkForUpdate({}, deps());
    expect(gitCalls).toHaveLength(0);
    now += CHECK_EVERY_MS + 1;
    await checkForUpdate({}, deps());
    expect(gitCalls.some((a) => a[0] === "fetch")).toBe(true);
  });

  it("a forced check waits a minute between asks", async () => {
    await checkForUpdate({ force: true }, deps());
    now += 10_000;
    const again = await checkForUpdate({ force: true }, deps());
    expect(again.throttled).toBe(50);
    now += 60_000;
    expect(
      (await checkForUpdate({ force: true }, deps())).throttled
    ).toBeUndefined();
  });

  it("keeps the last good answer when a fetch fails", async () => {
    for (let i = 1; i <= 2; i++) commit(pusher, `c${i}`);
    sh(pusher, "push", "-q", "origin", "main");
    await checkForUpdate({}, deps());
    sh(install, "remote", "set-url", "origin", path.join(tmp, "gone.git"));
    now += CHECK_EVERY_MS + 1;
    const { result } = await checkForUpdate({}, deps());
    expect(result.available).toBe(true);
    expect(result.error).toBeTruthy();
  });
});

describe("compareUrl", () => {
  const url = "https://github.com/acme/agent-os/compare/aaaa...bbbb";
  it("builds a link for https and ssh GitHub remotes", () => {
    for (const r of [
      "https://github.com/acme/agent-os.git",
      "https://github.com/acme/agent-os",
      "git@github.com:acme/agent-os.git",
      "ssh://git@github.com/acme/agent-os.git",
    ])
      expect(compareUrl(r, "aaaa", "bbbb")).toBe(url);
  });

  it("drops credentials and gives nothing for other hosts", () => {
    expect(
      compareUrl(
        "https://user:secret@github.com/acme/agent-os.git",
        "aaaa",
        "bbbb"
      )
    ).toBe(url);
    expect(
      compareUrl("https://git.example.com/acme/x.git", "a", "b")
    ).toBeNull();
    expect(compareUrl("/some/local/path", "a", "b")).toBeNull();
  });
});

describe("updateChecksEnabled", () => {
  it("runs in production, not in dev or tests, unless set", () => {
    expect(updateChecksEnabled({ NODE_ENV: "production" })).toBe(true);
    expect(
      updateChecksEnabled({ NODE_ENV: "production", AGENTOS_DEV: "1" })
    ).toBe(false);
    expect(updateChecksEnabled({ NODE_ENV: "test" })).toBe(false);
    expect(
      updateChecksEnabled({ NODE_ENV: "test", AGENTOS_UPDATE_CHECK: "on" })
    ).toBe(true);
    expect(
      updateChecksEnabled({
        NODE_ENV: "production",
        AGENTOS_UPDATE_CHECK: "off",
      })
    ).toBe(false);
  });
});
