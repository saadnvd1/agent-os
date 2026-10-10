import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getProvider } from "../providers";
import { shellQuote } from "../hosts/ssh";
import { runInBackground } from "../async-operations";
import { trustPromptKeys } from "../tasks/state";
import { BUS_BRIEF } from "./brief";
import { CLAUDE_STATUS_SETTINGS_FLAG } from "../program-status/claude-flag";
import {
  sessionProjectEnv,
  sessionRunningBrief,
} from "../project-config/session";

const execFileAsync = promisify(execFile);
const PROMPTS_DIR = path.join(os.homedir(), ".agent-os", "prompts");
export const BUS_BRIEF_FILE = path.join(
  os.homedir(),
  ".agent-os",
  "bus-brief.md"
);

export function ensureBusBrief(): void {
  fs.mkdirSync(path.dirname(BUS_BRIEF_FILE), { recursive: true });
  fs.writeFileSync(BUS_BRIEF_FILE, BUS_BRIEF);
}

// Who a session is and how it reaches AgentOS, set in its tmux environment so
// \`aos\` works from any agent CLI or plain shell inside it. The project's
// agentos.json env and the session's ports come first, so neither can
// override what AgentOS sets.
export function agentEnv(sessionId: string): Record<string, string> {
  const port = process.env.AGENTOS_PORT || process.env.PORT || "3011";
  return {
    ...sessionProjectEnv(sessionId),
    AGENTOS_SESSION_ID: sessionId,
    AGENTOS_URL: `http://127.0.0.1:${port}`,
    PATH: `${AOS_BIN_DIR}:${process.env.PATH ?? ""}`,
  };
}

// Shell startup files can rebuild PATH, so the launch command puts \`aos\` on
// it explicitly rather than trusting the tmux environment alone.
export const AOS_BIN_DIR = path.join(process.cwd(), "bin");

export function envArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
}

// Written just before the agent's tmux session is created: a session with
// no prompt file is not one launchClaude started.
export const promptFileFor = (sessionId: string) =>
  path.join(PROMPTS_DIR, `${sessionId}.prompt.md`);

// Start Claude in a new detached tmux session with a prompt and briefs. The
// prompt and briefs come from files so no quoting can mangle them, and a
// shell is left behind so the pane stays usable after the agent exits.
export async function launchClaude(opts: {
  sessionId: string;
  tmuxName: string;
  cwd: string;
  model: string;
  prompt: string;
  brief?: string;
  // Continue this Claude conversation; the prompt is its next message.
  resume?: string;
}): Promise<void> {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true });
  const promptFile = promptFileFor(opts.sessionId);
  const briefFile = path.join(PROMPTS_DIR, `${opts.sessionId}.brief.md`);
  fs.writeFileSync(promptFile, opts.prompt);
  fs.writeFileSync(
    briefFile,
    [opts.brief, sessionRunningBrief(opts.sessionId), BUS_BRIEF]
      .filter(Boolean)
      .join("\n\n")
  );

  const provider = getProvider("claude");
  const flags = provider
    .buildFlags({
      autoApprove: true,
      model: opts.model,
      sessionId: opts.resume,
    })
    .join(" ");
  const agent = `export PATH=${shellQuote(AOS_BIN_DIR)}:"$HOME/.local/bin:$PATH"; ${provider.command} ${flags} ${CLAUDE_STATUS_SETTINGS_FLAG} --append-system-prompt-file ${shellQuote(briefFile)} "$(cat ${shellQuote(promptFile)})"; exec "\${SHELL:-/bin/sh}" -l`;
  await execFileAsync(
    "tmux",
    [
      "new-session",
      "-d",
      "-s",
      opts.tmuxName,
      "-c",
      opts.cwd,
      ...envArgs(agentEnv(opts.sessionId)),
      agent,
    ],
    { cwd: opts.cwd }
  );
  runInBackground(
    () => acceptTrustPrompt(opts.tmuxName),
    `trust-${opts.sessionId}`
  );
}

// A folder Claude has never seen makes it ask to trust it, with "No, exit"
// selected. Move to the trust option, then confirm.
async function acceptTrustPrompt(tmuxName: string): Promise<void> {
  const target = `=${tmuxName}:`;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const { stdout } = await execFileAsync("tmux", [
        "capture-pane",
        "-t",
        target,
        "-p",
      ]);
      const keys = trustPromptKeys(stdout);
      if (keys) {
        await execFileAsync("tmux", ["send-keys", "-t", target, ...keys]);
        return;
      }
      if (/bypass permissions|\? for shortcuts/i.test(stdout)) return;
    } catch {
      return;
    }
  }
}
