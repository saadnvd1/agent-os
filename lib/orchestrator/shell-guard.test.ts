import os from "os";
import { describe, expect, it } from "vitest";
import { shellRefusal, type ShellContext } from "./shell-guard";
import { parseShell } from "./shell-parse";

// A project at /work/repo, another task's worktree at /work/other, its own
// quick change at /work/quick, AgentOS's state at /state with its folder
// /state/orch, and AgentOS's server as process 4242.
const inside = (p: string, root: string) =>
  p === root || p.startsWith(`${root}/`);
const ctx: ShellContext = {
  cwd: "/work/orch",
  writeRefusal: async (p) =>
    inside(p, "/work/repo") || inside(p, "/work/other")
      ? `${p} is inside a project repository or task worktree; use start_task or quick_change.`
      : inside(p, "/state") && !inside(p, "/state/orch")
        ? `${p} is in AgentOS's own state.`
        : null,
  isAgentOsState: async (p) => inside(p, "/state") && !inside(p, "/state/orch"),
  protectedPids: async () => new Set([4242]),
};
const check = (command: string) => shellRefusal(command, ctx);

async function expectRefused(commands: string[], why: RegExp) {
  for (const c of commands) expect(await check(c), c).toMatch(why);
}
async function expectAllowed(commands: string[]) {
  for (const c of commands) expect(await check(c), c).toBeNull();
}

describe("the orchestrator's shell", () => {
  it("runs reads, scripts, pipes and chains", async () => {
    await expectAllowed([
      "gh pr list",
      "gh pr view 5 --json state,mergeable",
      "gh pr checks 5",
      "gh run view 12 --log-failed | tail -50",
      "gh api repos/o/r/pulls/5",
      "gh api repos/o/r/pulls/5/merge",
      "gh api -X GET repos/o/r/pulls --jq '.[].number'",
      "gh pr list --json number | jq '.[] | .number'",
      "curl -s https://example.com/status",
      "curl -sfL -o /tmp/x.json https://example.com/x.json",
      "sqlite3 -readonly /state/agent-os.db 'select count(*) from sessions'",
      "sqlite3 -readonly -json /state/agent-os.db .tables",
      "sqlite3 /work/orch/scratch.db 'create table t (x)'",
      "~/.claude/skills/audit/node_modules/.bin/tsx ~/.claude/skills/audit/scripts/audit.ts --json",
      "python -c 'print(1)'",
      "python3 - <<'EOF'\nprint(2)\nEOF",
      "git -C /work/repo log --oneline | head -5 && git -C /work/repo status",
      "cd /work/repo && git diff main...HEAD --stat",
      "git -C /work/quick add -A && git -C /work/quick commit -m fix",
      "echo notes > /work/orch/notes.md; ls -la /work/orch",
      "rm -rf /tmp/scratch",
      "for f in a b; do wc -l $f; done",
      "date && npm test 2>&1 | tail -20",
      "kill 999",
      "pkill -f vitest",
      "tmux ls",
      "sm logs agentos",
      "grep -rn secret lib",
      "aos send peer 'merged #5; next up'",
    ]);
  });

  it("refuses merging, closing or retargeting a PR outside the gates", async () => {
    await expectRefused(
      [
        "gh pr merge 12 --squash",
        "gh -R o/r pr merge 12",
        "/opt/homebrew/bin/gh pr merge 1",
        "bash -c 'gh pr merge 1'",
        'sh -lc "gh pr merge 1 --auto"',
        "env GH_TOKEN=x gh pr merge 1",
        "GH_REPO=o/r gh pr merge 1",
        "gh pr list && gh pr merge 3",
        "echo 3 | xargs gh pr merge",
        "x=$(gh pr merge 3)",
        "gh api -X PUT repos/o/r/pulls/5/merge",
        "gh api --method=PUT repos/o/r/pulls/5/merge",
        "gh api -XPUT repos/o/r/pulls/5/merge",
        "gh api repos/o/r/pulls/5/merge -f merge_method=squash",
        "gh api repos/o/r/pulls/5/merge -F merge_method=squash",
        "gh api -X PATCH repos/o/r/pulls/5 -f base=main",
        "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"x\"}) { clientMutationId } }'",
        "curl -X PUT -H 'Authorization: token x' https://api.github.com/repos/o/r/pulls/5/merge",
        "curl -d '{}' https://api.github.com/repos/o/r/pulls/5/merge",
      ],
      /sign_off/
    );
    await expectRefused(
      ["gh pr close 4", "gh pr close 4 --comment bye"],
      /drop/
    );
    await expectRefused(
      [
        "gh pr edit 4 --base main",
        "gh pr edit 4 -B main",
        "gh pr edit 4 --base=main",
      ],
      /retargeting/
    );
    await expectAllowed([
      "gh pr edit 4 --title 'Better title'",
      "gh pr edit 4 -b body",
    ]);
  });

  it("refuses git push, however it's wrapped", async () => {
    await expectRefused(
      [
        "git push",
        "git -C /work/quick push origin HEAD",
        "sh -c 'git push origin main'",
        "/usr/bin/git push",
        "cd /work/repo && git push --force",
        "git status; git push",
        "git -c core.hooksPath=/dev/null push",
        "sudo -u me git push",
        "find . -maxdepth 0 -exec git push \\;",
        "eval 'git push'",
        "if true; then git push; fi",
      ],
      /quick_pr/
    );
  });

  it("refuses writes in a project repository or another task's worktree", async () => {
    await expectRefused(
      [
        "git -C /work/repo commit -m x",
        "cd /work/repo && git reset --hard",
        "cd /work/repo/src && git checkout main",
        "git --git-dir=/work/repo/.git stash",
        "git --work-tree /work/other rebase main",
        "git -C /work/other merge main",
        "git -C /work/repo clean -fdx",
        "git -C /work/repo rm README.md",
        "rm -rf /work/repo/src",
        "cd /work/repo; rm -f a.txt",
        "echo x > /work/repo/a.txt",
        "echo x 2>&1 >> /work/other/a.txt",
        "bash -c 'echo x > /work/repo/a.txt'",
        "cp notes.md /work/repo/docs/",
        "mv /work/other/a /tmp/a",
        "printf x | tee /work/repo/c",
        "sed -i '' s/a/b/ /work/repo/x.ts",
        "find /work/repo -name '*.log' -delete",
        "cd /work/repo && find . -exec rm {} +",
      ],
      /project repository or task worktree/
    );
    await expectRefused(
      ["cd $(git rev-parse --show-toplevel) && git commit -m x"],
      /only the shell knows/
    );
  });

  it("refuses writes to AgentOS's state", async () => {
    await expectRefused(
      [
        "sqlite3 /state/agent-os.db 'select 1'",
        "sqlite3 /state/agent-os.db",
        "sqlite3 -readonly /state/agent-os.db 'DELETE FROM sessions'",
        "sqlite3 -readonly /state/agent-os.db \"update sessions set status='x'\"",
        "sqlite3 -readonly /state/agent-os.db 'select 1; DROP TABLE sessions'",
        "sqlite3 -readonly /state/agent-os.db \"ATTACH '/tmp/x.db' AS y\"",
        "sqlite3 -readonly /state/agent-os.db 'alter table x add y'",
        "sqlite3 -readonly /state/agent-os.db 'INSERT INTO notes VALUES (1)'",
        "echo 'DELETE FROM sessions' | sqlite3 -readonly /state/agent-os.db",
        "sqlite3 -readonly /state/agent-os.db <<EOF\nDELETE FROM sessions;\nEOF",
        "sqlite3 -readonly /state/agent-os.db '.shell id'",
        "cd /state && sqlite3 agent-os.db 'select 1'",
        "/usr/bin/sqlite3 file:/state/agent-os.db?mode=rw 'select 1'",
      ],
      /sqlite3|SQL/
    );
    await expectRefused(
      [
        "rm /state/other.json",
        "echo x > /state/limits.json",
        "touch /state/worktrees/x",
      ],
      /AgentOS's own state/
    );
  });

  it("refuses stopping AgentOS or its tmux", async () => {
    await expectRefused(
      [
        "pkill -f server.ts",
        "pkill node",
        "killall node",
        "sudo pkill tmux",
        "tmux kill-server",
        "tmux -L test kill-session -t a",
        "kill 4242",
        "kill -9 4242",
        "kill $(lsof -ti tcp:3011)",
        "lsof -ti tcp:3011 | xargs kill",
        "kill -9 -1",
        "launchctl kickstart -k gui/501/com.example.agentos",
        "sm restart agentos",
        "serviceman stop agent-os",
      ],
      /never stop or restart AgentOS/
    );
  });

  it("refuses reading secret files", async () => {
    await expectRefused(
      [
        "cat ~/.ssh/id_ed25519",
        `cat ${os.homedir()}/.aws/credentials`,
        "cat .env",
        "source /work/app/.env.local",
        ". ./.env",
        "grep TOKEN < /work/app/.env",
        "docker run --env-file=.env x",
        "ls ~/.ssh | head",
      ],
      /never read secrets/
    );
  });

  it("allows tokenvault through tv and its folders", async () => {
    for (const c of [
      "tv get x y",
      "EXPO_TOKEN=\"$(tv get expo 'access token')\" eas build",
      "tv dump",
      "tv list",
      "bash -c 'tv dump | jq .'",
      "/usr/local/bin/tv get openai key",
      `ls ${os.homedir()}/dev/tokenvault`,
      `cat ${os.homedir()}/.config/tokenvault/master.key`,
    ])
      expect(await shellRefusal(c, ctx), c).toBeNull();
    await expectRefused(
      [`cat ${os.homedir()}/.config/tokenvault/../../.ssh/id_ed25519`],
      /never read secrets/
    );
  });

  it("refuses what it can't read", async () => {
    await expectRefused(["echo 'unclosed", 'echo "x', "echo $(id"], /Refused/);
  });
});

describe("parseShell", () => {
  it("reads the commands a shell would run, with their redirects", () => {
    expect(parseShell("a 'b c' \"d $HOME\" > out 2>&1 | e <in")).toEqual([
      {
        words: ["a", "b c", `d ${os.homedir()}`],
        writes: ["out"],
        reads: [],
        stdin: "",
      },
      { words: ["e"], writes: [], reads: ["in"], stdin: "" },
    ]);
  });

  it("reads into substitutions and heredocs", () => {
    const r = parseShell('x "$(git push)" `id` <<-EOF\n\tbody\n\tEOF\nnext');
    expect(r).not.toBeTypeOf("string");
    const words = (r as { words: string[] }[]).map((c) => c.words[0]);
    expect(words).toEqual(["git", "id", "x", "next"]);
    expect((r as { stdin: string }[])[2].stdin).toBe("body\n");
  });
});
