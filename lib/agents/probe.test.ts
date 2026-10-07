import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseVersion, probeAgent } from "./probe";

describe("parseVersion", () => {
  it("reads each CLI's way of printing its version", () => {
    expect(parseVersion("codex-cli 0.156.0\n")).toBe("0.156.0");
    expect(parseVersion("1.18.23")).toBe("1.18.23");
    expect(parseVersion("opencode v2.0.1")).toBe("2.0.1");
    expect(parseVersion("2026.01.09-231024f")).toBe("2026.01.09-231024f");
    expect(parseVersion("0.0.1774126892-geb7ca3 (released 2026-03-21)")).toBe(
      "0.0.1774126892-geb7ca3"
    );
    expect(parseVersion("no version here")).toBeUndefined();
  });
});

// Each test gets its own home and a bin folder of fake CLIs, so nothing
// depends on what this machine has installed or signed in to.
const KEYS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "OPENROUTER_API_KEY",
  "XAI_API_KEY",
  "MISTRAL_API_KEY",
  "CEREBRAS_API_KEY",
  "CURSOR_API_KEY",
  "AMP_API_KEY",
];
const saved = { ...process.env };
let home: string;
let bin: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "probe-"));
  bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  process.env.HOME = home;
  process.env.NVM_DIR = path.join(home, "nvm");
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  // In place: a replaced process.env no longer reaches os.homedir().
  for (const k of Object.keys(process.env))
    if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
  fs.rmSync(home, { recursive: true, force: true });
});

// A fake CLI: prints a version, and exits with `loginExit` for `login status`.
function cli(
  name: string,
  opts: { versionExit?: number; loginExit?: number } = {}
) {
  const file = path.join(bin, name);
  fs.writeFileSync(
    file,
    `#!/bin/sh
if [ "$1" = "--version" ]; then echo "${name} 1.2.3"; exit ${opts.versionExit ?? 0}; fi
if [ "$1" = "login" ]; then exit ${opts.loginExit ?? 0}; fi
`
  );
  fs.chmodSync(file, 0o755);
}

const write = (rel: string, body: string) => {
  const file = path.join(home, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
};

describe("probeAgent", () => {
  it("says a CLI that isn't anywhere isn't installed", async () => {
    expect(await probeAgent("aider", "no-such-agent-cli-xyz")).toEqual({
      installed: false,
      auth: "unknown",
      hint: "Install no-such-agent-cli-xyz",
    });
  });

  it("calls a CLI that won't run a broken install", async () => {
    cli("pi", { versionExit: 2 });
    expect(await probeAgent("pi", "pi")).toMatchObject({ installed: false });
  });

  it("reads Codex's sign-in from its exit code", async () => {
    cli("codex", { loginExit: 1 });
    expect(await probeAgent("codex", "codex")).toMatchObject({
      installed: true,
      version: "1.2.3",
      auth: "needs-login",
      hint: "Run `codex login` in a terminal",
    });
    cli("codex", { loginExit: 0 });
    expect(await probeAgent("codex", "codex")).toMatchObject({ auth: "ready" });
    cli("codex", { loginExit: 3 });
    expect(await probeAgent("codex", "codex")).toMatchObject({
      auth: "unknown",
    });
  });

  it("needs a Pi login unless it has credentials or a provider key", async () => {
    cli("pi");
    write(".pi/agent/auth.json", "{}");
    expect(await probeAgent("pi", "pi")).toMatchObject({ auth: "needs-login" });
    write(".pi/agent/auth.json", '{"google":{"type":"api_key"}}');
    expect(await probeAgent("pi", "pi")).toMatchObject({ auth: "ready" });
    write(".pi/agent/auth.json", "{}");
    process.env.GEMINI_API_KEY = "k";
    expect(await probeAgent("pi", "pi")).toMatchObject({ auth: "ready" });
  });

  it("reads Cursor's, Amp's and Gemini's own credential files", async () => {
    for (const name of ["cursor-agent", "amp", "gemini"]) cli(name);
    write(".cursor/cli-config.json", '{"version":1}');
    expect(await probeAgent("cursor", "cursor-agent")).toMatchObject({
      auth: "needs-login",
    });
    write(".cursor/cli-config.json", '{"authInfo":{"email":"x"}}');
    expect(await probeAgent("cursor", "cursor-agent")).toMatchObject({
      auth: "ready",
    });
    expect(await probeAgent("amp", "amp")).toMatchObject({
      auth: "needs-login",
    });
    write(".local/share/amp/secrets.json", '{"apiKey@x":"k"}');
    expect(await probeAgent("amp", "amp")).toMatchObject({ auth: "ready" });
    expect(await probeAgent("gemini", "gemini")).toMatchObject({
      auth: "needs-login",
    });
    write(".gemini/oauth_creds.json", "{}");
    expect(await probeAgent("gemini", "gemini")).toMatchObject({
      auth: "ready",
    });
  });

  it("needs nothing for a plain terminal", async () => {
    expect(await probeAgent("shell", "")).toEqual({
      installed: true,
      auth: "ready",
    });
  });
});
