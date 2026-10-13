import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildArgs, getProvider } from "../providers";
import { getProviderDefinition, type ProviderId } from "./registry";

const args = (id: ProviderId, o: Parameters<typeof buildArgs>[1]) =>
  buildArgs(getProviderDefinition(id), o);

describe("buildArgs", () => {
  it("puts Codex's resume and fork subcommands first", () => {
    expect(
      args("codex", { sessionId: "t1", autoApprove: true, model: "gpt-6-luna" })
    ).toEqual([
      "resume",
      "t1",
      "--dangerously-bypass-approvals-and-sandbox",
      "--model",
      "gpt-6-luna",
    ]);
    expect(args("codex", { parentSessionId: "t1" })).toEqual(["fork", "t1"]);
  });

  it("starts Kiro in chat, trusting its tools, with the prompt last", () => {
    expect(
      args("kiro", { autoApprove: true, model: "m", initialPrompt: "hi" })
    ).toEqual(["chat", "--trust-all-tools", "--model", "m", "hi"]);
    expect(args("amazonq", { sessionId: "s1" })).toEqual(["chat"]);
  });

  it("signs in before Kiro starts, and stops if that fails", () => {
    expect(getProvider("kiro").preamble).toBe(
      "{ kiro-cli whoami >/dev/null 2>&1 || { echo 'AgentOS: signing in'; kiro-cli login --use-device-flow; s=$?; echo 'AgentOS: sign-in finished'; [ $s -eq 0 ]; }; } && "
    );
    expect(getProvider("amazonq").preamble).toContain(
      "q login --use-device-flow"
    );
    expect(getProvider("claude").preamble).toBe("");
  });

  it("resumes GitHub Copilot by id and asks it for all permissions", () => {
    expect(
      args("copilot", { sessionId: "s1", autoApprove: true, model: "m" })
    ).toEqual(["--resume=s1", "--allow-all", "--model", "m"]);
    expect(args("copilot", { initialPrompt: "hi" })).toEqual(["-i", "hi"]);
  });

  it("resumes and forks OpenCode by session, with its own auto-approve", () => {
    expect(args("opencode", { sessionId: "ses_1", autoApprove: true })).toEqual(
      ["--session", "ses_1", "--auto"]
    );
    expect(args("opencode", { parentSessionId: "ses_1" })).toEqual([
      "--session",
      "ses_1",
      "--fork",
    ]);
  });

  it("resumes Pi by session and passes its model, but not the agent default", () => {
    expect(
      args("pi", { sessionId: "01a1", model: "google/gemini-2.5-flash" })
    ).toEqual(["--session", "01a1", "--model", "google/gemini-2.5-flash"]);
    expect(args("pi", { model: "default", initialPrompt: "hi" })).toEqual([
      "hi",
    ]);
  });

  it("keeps Gemini interactive after its first prompt", () => {
    expect(args("gemini", { initialPrompt: "hi" })).toEqual(["-i", "hi"]);
  });

  it("forks Claude from its parent's conversation", () => {
    expect(args("claude", { parentSessionId: "p" })).toEqual([
      "--resume",
      "p",
      "--fork-session",
    ]);
  });
});

describe("buildFlags", () => {
  it("quotes a prompt for the shell", () => {
    expect(
      getProvider("codex").buildFlags({ initialPrompt: "it's $HOME" })
    ).toEqual([`'it'\\''s $HOME'`]);
  });
});

describe("browser safety", () => {
  // The new-session dialog and the terminal launcher import these.
  it.each([
    "../providers.ts",
    "./registry.ts",
    "../model-catalog.ts",
    "../agents/signin-screen.ts",
  ])("%s imports nothing Node-only", (file) => {
    const source = readFileSync(join(__dirname, file), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    const allowed = new Set([
      "./providers/registry",
      "./registry",
      "./providers",
      "./agents/signin-screen",
    ]);
    expect(imports.filter((i) => !allowed.has(i))).toEqual([]);
  });
});
