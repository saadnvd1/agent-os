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

// Running Claude sessions execute the hook and new ones read the settings at
// any moment, so a file is replaced whole (rename) and only when it changed.
function writeAtomic(dest: string, data: Buffer, mode = 0o644): void {
  try {
    if (fs.readFileSync(dest).equals(data)) return;
  } catch {
    // Not there yet.
  }
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, dest);
}

// Copied rather than pointed at, so a settings file every AgentOS on this
// machine writes the same way never names a checkout that's gone.
export function installClaudeStatusHooks(): void {
  try {
    fs.mkdirSync(path.dirname(HOOK), { recursive: true });
    writeAtomic(HOOK, fs.readFileSync(SOURCE), 0o755);
    writeAtomic(
      SETTINGS,
      Buffer.from(JSON.stringify(claudeStatusSettings(), null, 2) + "\n")
    );
  } catch (err) {
    console.error("[osc7501] could not install the Claude hooks:", err);
  }
}
