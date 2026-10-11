import { describe, expect, it } from "vitest";
import {
  genericPath,
  manualClasses,
  normalizeCommand,
  normalizeError,
  repoPath,
  shellReadTarget,
  wasteClasses,
} from "./normalize";

describe("normalizeCommand", () => {
  it("makes the same command in two worktrees one key", () => {
    const a = normalizeCommand(
      "cd /Users/alice/.agent-os/worktrees/proj-fix-1a2b && git diff main...HEAD --stat"
    );
    const b = normalizeCommand(
      "cd /home/bob/.agent-os/worktrees/proj-other-9f9f && git diff main...HEAD --stat"
    );
    expect(a).toBe("git diff main...HEAD --stat");
    expect(a).toBe(b);
  });

  it("replaces quoted text, numbers, shas and ids", () => {
    expect(normalizeCommand(`grep -n "foo|bar" lib/x.ts | head -40`)).toBe(
      'grep -n "…" lib/x.ts | head -N'
    );
    expect(normalizeCommand("git show 7d9bd28 --stat")).toBe(
      "git show <sha> --stat"
    );
    expect(normalizeCommand("aos send 1b2c3d4e 'hi'")).toBe(
      "aos send <sha> '…'"
    );
    expect(
      normalizeCommand("open ?session=01234567-89ab-cdef-0123-456789abcdef")
    ).toBe("open ?session=<id>");
  });

  it("keeps a word that only looks like hex", () => {
    expect(normalizeCommand("echo deadbeefcafe")).toBe("echo deadbeefcafe");
  });

  it("drops a heredoc's body", () => {
    expect(normalizeCommand("python3 - <<'EOF'\nprint(1)\nEOF")).toBe(
      "python3 - <<EOF"
    );
  });
});

describe("paths", () => {
  it("takes the machine out of a path", () => {
    expect(genericPath("/Users/alice/dev/x")).toBe("~/dev/x");
    expect(genericPath("/Users/alice/.agent-os/orchestrators/ws1/notes")).toBe(
      "<orch>/notes"
    );
    expect(genericPath("/private/var/folders/ab/T/x.log")).toBe("<tmp>");
    expect(repoPath("/Users/alice/.agent-os/worktrees/proj-1/lib/a.ts")).toBe(
      "lib/a.ts"
    );
  });
});

describe("normalizeError", () => {
  it("keeps the first telling line with paths and numbers replaced", () => {
    expect(
      normalizeError("Exit code 1\n(eval):3: no matches found: --include=*.ts")
    ).toBe("(eval):N: no matches found: --include=*.ts");
    expect(
      normalizeError(
        "<tool_use_error>File does not exist: /Users/a/x/y.ts</tool_use_error>"
      )
    ).toBe("File does not exist: <path>");
  });
});

describe("wasteClasses", () => {
  it.each([
    ["cat lib/big.ts", ["cat-whole-file"]],
    ["sed -n '1,400p' lib/big.ts", ["wide-sed-range"]],
    ["grep -rn foo lib app", ["unscoped-grep"]],
    ["npx vitest run", ["full-test-suite"]],
    ["npm test", ["full-test-suite"]],
    ["git diff main...HEAD", ["full-diff"]],
    ["gh run view 123 --log-failed", ["ci-log"]],
    ["sleep 30; gh pr checks 5", ["poll-wait"]],
    ["until curl -sf x; do sleep 1; done", ["poll-wait"]],
  ])("%s", (command, classes) => {
    expect(wasteClasses(command)).toEqual(classes);
  });

  it.each([
    "cat lib/big.ts | head -50",
    "sed -n '1,120p' lib/big.ts",
    "grep -rln foo lib",
    "grep -rn foo lib | head",
    "npx vitest run lib/a.test.ts",
    "git diff --stat",
    "git show abc1234 -- lib/a.ts",
    // A pipe inside a pattern isn't a pipeline: no runner is started here.
    `grep -rl "renderHook\\|vitest-environment" lib --include=*.ts | head`,
    "cat > out.md <<'EOF'",
  ])("%s is scoped", (command) => {
    expect(wasteClasses(command)).toEqual([]);
  });
});

describe("manualClasses", () => {
  it("spots a hand-stripped trailer, not a commit that mentions attribution", () => {
    expect(
      manualClasses(
        "git log -1 --format=%B | sed '/^Co-Authored-By/d' | git commit --amend -F -"
      )
    ).toContain("attribution-strip");
    expect(
      manualClasses("git filter-branch --msg-filter 'cat' HEAD~3..HEAD")
    ).toContain("attribution-strip");
    expect(
      manualClasses(`git commit -m "fix: attribution follow-ups"`)
    ).toEqual([]);
  });

  it("names rebases, cleanups, CI failures and force pushes", () => {
    expect(manualClasses("git fetch && git rebase origin/main")).toEqual([
      "rebase",
    ]);
    expect(manualClasses("git rebase --continue")).toEqual([]);
    expect(manualClasses("env -u TMUX tmux -S x kill-server")).toEqual([
      "dev-cleanup",
    ]);
    expect(
      manualClasses("lsof -ti tcp:3101 -sTCP:LISTEN | xargs kill")
    ).toEqual(["dev-cleanup"]);
    expect(manualClasses("gh run view 1 --log-failed | tail")).toEqual([
      "ci-failure",
    ]);
    expect(manualClasses("git push --force-with-lease origin HEAD")).toEqual([
      "force-push",
    ]);
  });
});

describe("shellReadTarget", () => {
  it("finds the file a plain read targets", () => {
    expect(shellReadTarget("cat lib/a.ts")).toBe("lib/a.ts");
    expect(shellReadTarget("sed -n '10,80p' lib/a.ts")).toBe("lib/a.ts");
    expect(shellReadTarget("head -n 40 lib/a.ts")).toBe("lib/a.ts");
  });

  it("isn't fooled by a pipe's limiter", () => {
    expect(shellReadTarget("ls | head -5")).toBeNull();
    expect(shellReadTarget("git log | tail -20")).toBeNull();
  });
});
