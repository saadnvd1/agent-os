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
