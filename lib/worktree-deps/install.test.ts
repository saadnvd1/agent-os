import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { detectPackageManager, setupEnv } from "./install";
import { setupWorktree, type SetupResult } from "../env-setup";
import { bringDependencies } from ".";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-install-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const touch = (...files: string[]) =>
  files.forEach((f) => fs.writeFileSync(path.join(dir, f), "{}"));

describe("detectPackageManager", () => {
  it("tries the lockfile's frozen install before a plain one, with dev deps", () => {
    touch("package.json", "package-lock.json");
    expect(detectPackageManager(dir)?.installs).toEqual([
      "npm ci --include=dev",
      "npm install --include=dev",
    ]);
  });

  it("picks the package manager by lockfile", () => {
    touch("package.json", "pnpm-lock.yaml");
    expect(detectPackageManager(dir)?.installs[0]).toBe(
      "pnpm install --frozen-lockfile --prod=false"
    );
    touch("bun.lock");
    expect(detectPackageManager(dir)?.installs[0]).toBe(
      "bun install --frozen-lockfile"
    );
  });

  it("has nothing to freeze to without a lockfile", () => {
    touch("package.json");
    expect(detectPackageManager(dir)?.installs).toEqual([
      "npm install --include=dev",
    ]);
    fs.rmSync(path.join(dir, "package.json"));
    expect(detectPackageManager(dir)).toBeNull();
  });
});

describe("setupEnv", () => {
  it("drops what makes an install skip devDependencies", () => {
    const env = setupEnv(
      {
        NODE_ENV: "production",
        npm_config_production: "true",
        NPM_CONFIG_OMIT: "dev",
        PATH: "/bin",
      },
      { PORT: "3000" }
    );
    expect(env).toEqual({ PATH: "/bin", PORT: "3000" });
  });
});

describe("setupWorktree under a production server", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("runs setup commands without NODE_ENV=production", async () => {
    // The live server runs with NODE_ENV=production; vitest sets "test".
    vi.stubEnv("NODE_ENV", "production");
    fs.mkdirSync(path.join(dir, ".agent-os"));
    fs.writeFileSync(
      path.join(dir, ".agent-os", "worktrees.json"),
      JSON.stringify({
        setup: [
          'node -e "process.stdout.write(String(process.env.NODE_ENV))" > env.txt',
        ],
      })
    );
    const result = await setupWorktree({ worktreePath: dir, sourcePath: dir });
    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(dir, "env.txt"), "utf-8")).toBe(
      "undefined"
    );
  });
});

describe("bringDependencies", () => {
  const fresh = (): SetupResult => ({
    success: true,
    steps: [],
    envFilesCopied: [],
    durationMs: 0,
  });
  const notCloned = async () => ({ ok: false, reason: "no", cloned: [] });
  beforeEach(() => touch("package.json", "package-lock.json"));

  it("clones and installs nothing when the clone works", async () => {
    const ran: string[] = [];
    const result = fresh();
    await bringDependencies(
      result,
      dir,
      dir,
      {},
      {
        clone: async () => ({
          ok: true,
          cloned: [{ rel: "node_modules", from: "spare" as const }],
        }),
        run: async (cmd) => (ran.push(cmd), { success: true, output: "" }),
      }
    );
    expect(ran).toEqual([]);
    expect(result.steps.map((s) => s.name)).toEqual(["Clone dependencies"]);
  });

  it("falls back from the frozen install to a plain one", async () => {
    const ran: string[] = [];
    const result = fresh();
    await bringDependencies(
      result,
      dir,
      dir,
      {},
      {
        clone: notCloned,
        run: async (cmd) => (
          ran.push(cmd),
          cmd.startsWith("npm ci")
            ? { success: false, output: "", error: "out of sync" }
            : { success: true, output: "" }
        ),
      }
    );
    expect(ran).toEqual(["npm ci --include=dev", "npm install --include=dev"]);
    expect(result.success).toBe(true);
  });

  it("fails when every install fails", async () => {
    const result = fresh();
    await bringDependencies(
      result,
      dir,
      dir,
      {},
      {
        clone: notCloned,
        run: async () => ({ success: false, output: "", error: "offline" }),
      }
    );
    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(2);
  });
});
