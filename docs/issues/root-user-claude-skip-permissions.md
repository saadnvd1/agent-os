# Claude Code --dangerously-skip-permissions Fails as Root

**Status:** Fixed (March 22, 2026)
**Commit:** `d2bb613`

## Problem

When AgentOS is running on a VM as root (common for self-hosted setups), sessions using Claude Code with auto-approve enabled would immediately exit. The tmux session would flash the banner and die — no error visible to the user.

## Symptoms

- Tmux session shows `[exited]` immediately after attaching
- The AgentOS UI shows the session but the terminal is dead
- Other providers (Codex, Aider, etc.) are unaffected

## Root Cause

Claude Code explicitly blocks `--dangerously-skip-permissions` when running as root/sudo for security reasons:

```
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

The init script (`/api/sessions/init-script`) generates a shell script that runs `exec claude --dangerously-skip-permissions`. When running as root, Claude exits with this error, and since `exec` replaces the shell process, the tmux session dies instantly.

## How We Debugged It

1. Checked if the init script file existed in `/tmp` — it did
2. Checked if the project directory existed — it did
3. Checked if `claude` was in PATH and working — it was
4. Reproduced by running the init script inside a test tmux session with `sleep 30` after it to capture the output:
   ```bash
   tmux new-session -d -s test "bash /tmp/agent-os-init-*.sh; echo EXIT: $?; sleep 30"
   tmux capture-pane -t test -p
   ```
5. This revealed the `--dangerously-skip-permissions cannot be used with root/sudo` error

## Fix

Set the `IS_SANDBOX=1` environment variable before launching Claude when running as root. This signals to Claude Code that the environment is a sandboxed/containerized setup where root is expected.

**`app/api/sessions/init-script/route.ts`** — Added root detection in the generated shell script:
```bash
if [ "$(id -u)" = "0" ]; then
  export IS_SANDBOX=1
fi
```

**`app/api/sessions/[id]/summarize/route.ts`** — Added root detection for the summarize endpoint which also spawns Claude directly:
```typescript
const isRoot = process.getuid?.() === 0;
const envPrefix = isRoot ? "IS_SANDBOX=1 " : "";
```

## Lesson

When sessions die immediately with no visible error, run the init script manually with a trailing `sleep` to capture output before the tmux pane closes. The `exec` in the script replaces the shell, so any error from the agent command kills the session silently.
