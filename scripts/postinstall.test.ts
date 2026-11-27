import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "postinstall.mjs");
const run = (env: Record<string, string>) =>
  spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      AGENTOS_POSTINSTALL_NO_TTY: "1",
      ...env,
    },
  });

describe("postinstall", () => {
  it("a global install says what to run next", () => {
    const r = run({ npm_config_global: "true" });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("agent-os install");
  });

  it("a local install (the repo's own pnpm install) is silent and succeeds", () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("");
  });

  it("never fails the install", () => {
    const r = run({ npm_config_global: "true", CI: "" });
    expect(r.status).toBe(0);
  });
});
