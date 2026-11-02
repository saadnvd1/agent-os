import { describe, expect, it } from "vitest";
import os from "os";
import { createWorkspace, updateWorkspace } from "@/lib/workspaces";
import { guardHook } from "@/lib/chat/drivers/claude-approvals";
import { ensureOrchestrator } from "./home";
import { orchestratorFullAccess } from "./full-access";
import { orchestratorBrief } from "./brief";
import { orchestratorToolRefusal } from "./write-guard";
import { signOffTarget } from "./external-gates";

const home = os.homedir();
const guard =
  (s: Parameters<typeof orchestratorToolRefusal>[0]) =>
  (tool: string, input: Record<string, unknown>) =>
    orchestratorToolRefusal(s, tool, input);

const COMMANDS = [
  "git -C /somewhere/repo push origin HEAD:main",
  "gh pr merge 12 --squash",
  "gh pr close 3",
  "gh pr edit 3 --base dev",
  "git -C /somewhere/repo commit -am x",
  "git -C /somewhere/repo stash",
  "git -C /somewhere/repo clean -fd",
  "aos sweep --arm",
  "aos stop some-session",
  `cat ${home}/.ssh/id_ed25519`,
  `echo x > ${home}/.zshrc`,
];

const WRITES = [
  `${home}/.agent-os/state.json`,
  `${home}/.zshrc`,
  `${home}/Library/LaunchAgents/x.plist`,
  `${home}/dev/app/.claude/settings.json`,
  `${home}/dev/app/CLAUDE.md`,
  `${home}/dev/app/.mcp.json`,
  `${home}/dev/app/.git/hooks/pre-commit`,
];

function orchestrator(fullAccess?: boolean) {
  const w = createWorkspace(`fa-${Math.random().toString(36).slice(2, 8)}`);
  if (fullAccess === false) updateWorkspace(w.id, { orchFullAccess: false });
  return { w: w.id, o: ensureOrchestrator(w.id) };
}

describe("Orchestrator full access", () => {
  it("is on by default, and can be switched off", () => {
    const { w, o } = orchestrator();
    expect(orchestratorFullAccess(o)).toBe(true);
    updateWorkspace(w, { orchFullAccess: false });
    expect(orchestratorFullAccess(o)).toBe(false);
    updateWorkspace(w, { orchFullAccess: true });
    expect(orchestratorFullAccess(o)).toBe(true);
  });

  it("lets the orchestrator run and write anything", async () => {
    const { o } = orchestrator();
    const g = guard(o);
    for (const command of COMMANDS)
      expect(await g("Bash", { command }), command).toBeNull();
    for (const file_path of WRITES)
      for (const tool of ["Write", "Edit"])
        expect(await g(tool, { file_path }), file_path).toBeNull();
  });

  it("warns, and doesn't refuse, a command that stops AgentOS or its tmux", async () => {
    const { o } = orchestrator();
    for (const command of [
      "tmux kill-server",
      "pkill -f tsx",
      "sm restart agentos",
    ]) {
      const r = await guard(o)("Bash", { command });
      expect(r, command).toMatchObject({
        warning: expect.stringMatching(/^Warning:/),
      });
    }
  });

  it("restores every refusal when it is off", async () => {
    const { o } = orchestrator(false);
    const g = guard(o);
    for (const command of [
      ...COMMANDS.slice(0, 4),
      "aos sweep --arm",
      "tmux kill-server",
    ])
      expect(await g("Bash", { command }), command).toMatch(/^Refused/);
    for (const file_path of [`${home}/.zshrc`, `${home}/.agent-os/state.json`])
      expect(await g("Write", { file_path }), file_path).toMatch(/\w/);
  });

  it("never applies to a session that isn't an orchestrator", async () => {
    const { o } = orchestrator();
    const task = { ...o, role: null } as unknown as typeof o;
    expect(orchestratorFullAccess(task)).toBe(false);
    expect(
      await guard(task)("Bash", { command: "git -C /somewhere/repo push" })
    ).toMatch(/^Refused/);
    expect(await guard(task)("Write", { file_path: `${home}/.zshrc` })).toMatch(
      /\w/
    );
  });

  it("turns a guard's warning into context and a refusal into a deny", async () => {
    const hook = (r: string | null | { warning: string }) =>
      guardHook(async () => r)(
        {
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: {},
        } as never,
        undefined,
        { signal: new AbortController().signal }
      );
    expect(await hook({ warning: "careful" })).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: "careful",
      },
    });
    expect(await hook("no")).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    expect(await hook(null)).toEqual({});
  });

  it("allows a direct merge only with full access, and only with a reason", async () => {
    const off = orchestrator(false);
    await expect(
      signOffTarget(off.w, "#1", { direct: true, reason: "because" })
    ).rejects.toThrow(/needs Orchestrator full access/);
    const on = orchestrator();
    await expect(
      signOffTarget(on.w, "#1", { direct: true, reason: " " })
    ).rejects.toThrow(/needs a reason/);
  });

  it("writes the brief for each mode, keeping the hard lines and untrusted rules", () => {
    const input = { workspace: "W", projects: [] };
    const on = orchestratorBrief({ ...input, fullAccess: true });
    const off = orchestratorBrief({ ...input, fullAccess: false });
    expect(on).not.toMatch(/Merge only through the gates/);
    expect(on).toMatch(/direct true and a reason/);
    expect(on).toMatch(/no cap on how many are open/);
    expect(off).toMatch(/Merge only through the gates/);
    expect(off).toMatch(/At most a few open at once/);
    expect(off).toMatch(/A deny list refuses/);
    for (const brief of [on, off]) {
      expect(brief).toMatch(/## Hard lines: always an ask for the owner/);
      expect(brief).toMatch(/Anything public or outbound/);
      expect(brief).toMatch(/## Untrusted text/);
      expect(brief).toMatch(/never print, echo or log a value/);
    }
  });
});
