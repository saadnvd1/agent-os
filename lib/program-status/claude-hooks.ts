import fs from "fs";
import os from "os";
import path from "path";

const DIR = path.join(os.homedir(), ".agent-os");
const HOOK = path.join(DIR, "bin", "agentos-status");
const SETTINGS = path.join(DIR, "claude-status-hooks.json");
const SOURCE = path.join(process.cwd(), "scripts", "claude-status-hook.sh");

const EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "Notification",
  "Stop",
  "SessionEnd",
];
const TOOL_EVENTS = new Set(["PreToolUse", "PermissionRequest", "PostToolUse"]);

export function claudeStatusSettings(hook = HOOK) {
  return {
    hooks: Object.fromEntries(
      EVENTS.map((event) => [
        event,
        [
          {
            ...(TOOL_EVENTS.has(event) && { matcher: "*" }),
            hooks: [
              {
                type: "command",
                command: `${JSON.stringify(hook)} ${event}`,
                timeout: 5,
              },
            ],
          },
        ],
      ])
    ),
  };
}

// Copied rather than pointed at, so a settings file every AgentOS on this
// machine writes the same way never names a checkout that's gone.
export function installClaudeStatusHooks(): void {
  try {
    fs.mkdirSync(path.dirname(HOOK), { recursive: true });
    fs.copyFileSync(SOURCE, HOOK);
    fs.chmodSync(HOOK, 0o755);
    fs.writeFileSync(
      SETTINGS,
      JSON.stringify(claudeStatusSettings(), null, 2) + "\n"
    );
  } catch (err) {
    console.error("[osc7501] could not install the Claude hooks:", err);
  }
}
