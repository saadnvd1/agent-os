import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";

const script = path.resolve(__dirname, "sync-cli-links");

function setup() {
  const root = tempDir("aos-synclinks-");
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  const clone = (name: string) => {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, "bin"), { recursive: true });
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(dir, "bin/aos"), "");
    fs.writeFileSync(path.join(dir, "scripts/agent-os"), "");
    return dir;
  };
  const live = clone("live");
  const old = clone("old");
  fs.writeFileSync(
    path.join(home, "live-server.json"),
    JSON.stringify({ cwd: live })
  );
  const run = (...args: string[]) =>
    execFileSync(script, args, {
      encoding: "utf-8",
      env: { ...process.env, AOS_BIN_DIR: bin, AGENT_OS_HOME: home },
    });
  return { bin, home, live, old, run };
}

describe("sync-cli-links", () => {
  it("repoints a link into another clone and logs it", () => {
    const t = setup();
    fs.symlinkSync(path.join(t.old, "bin/aos"), path.join(t.bin, "aos"));
    const out = t.run();
    expect(fs.readlinkSync(path.join(t.bin, "aos"))).toBe(
      path.join(t.live, "bin/aos")
    );
    expect(out).toContain("repointed");
    expect(out).toContain(t.old);
    expect(t.run()).toBe("");
  });

  it("leaves absent links alone unless asked to create them", () => {
    const t = setup();
    t.run();
    expect(fs.existsSync(path.join(t.bin, "aos"))).toBe(false);
    t.run("create");
    expect(fs.readlinkSync(path.join(t.bin, "aos"))).toBe(
      path.join(t.live, "bin/aos")
    );
    expect(fs.readlinkSync(path.join(t.bin, "agent-os"))).toBe(
      path.join(t.live, "scripts/agent-os")
    );
  });

  it("never replaces a real file", () => {
    const t = setup();
    fs.writeFileSync(path.join(t.bin, "aos"), "mine");
    t.run("create");
    expect(fs.readFileSync(path.join(t.bin, "aos"), "utf-8")).toBe("mine");
  });
});
