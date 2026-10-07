import { describe, expect, it } from "vitest";
import type { CheckRow } from "./checks";
import { evaluateGates, type GateInput } from "./gates";
import { parseRaw, ruleBreaks, secretsIn, sensitiveFiles } from "./diff";

const SHA = "abc1234def";
const check = (over: Partial<CheckRow> = {}): CheckRow => ({
  id: 1,
  workspace_id: "w",
  session_id: "t",
  sha: SHA,
  kind: "review",
  status: "pass",
  detail: null,
  created_at: "",
  ...over,
});
const input = (over: Partial<GateInput> = {}): GateInput => ({
  sha: SHA,
  checks: "pass",
  settleIn: 0,
  review: check(),
  blocked: null,
  waitingOn: null,
  ruleBreaks: [],
  fromCard: false,
  scope: null,
  stackRefusal: null,
  codeReviewRefusal: null,
  ...over,
});
const gate = (i: GateInput, name: string) =>
  evaluateGates(i).find((g) => g.gate === name)!;

describe("the merge gates", () => {
  it("all pass", () => {
    expect(evaluateGates(input()).every((g) => g.state === "pass")).toBe(true);
  });

  it("ci: waits while running or settling, fails when red, and no CI goes to Saad", () => {
    expect(gate(input({ checks: "pending" }), "ci").state).toBe("wait");
    expect(gate(input({ checks: "fail", failing: "test" }), "ci")).toEqual({
      gate: "ci",
      state: "fail",
      reason: 'CI failed on abc1234 (<untrusted source="CI">test</untrusted>)',
    });
    expect(gate(input({ settleIn: 40 }), "ci")).toMatchObject({
      state: "wait",
      reason: "CI is green on abc1234 but settling: 40s more with no new check",
    });
    expect(gate(input({ checks: "none", settleIn: 40 }), "ci").state).toBe(
      "wait"
    );
    expect(gate(input({ checks: "none" }), "ci")).toMatchObject({
      state: "escalate",
      reason: expect.stringContaining("no checks to gate a merge on"),
    });
  });

  it("review: only a pass of this exact commit counts", () => {
    expect(gate(input({ review: null }), "review").state).toBe("wait");
    expect(
      gate(input({ review: check({ sha: "older00" }) }), "review")
    ).toMatchObject({
      state: "wait",
      reason: expect.stringContaining("call review"),
    });
    expect(
      gate(input({ review: check({ status: "running" }) }), "review").state
    ).toBe("wait");
    expect(
      gate(
        input({
          review: check({
            status: "block",
            detail: "- [blocking] a.ts: null deref",
          }),
        }),
        "review"
      )
    ).toMatchObject({
      state: "fail",
      reason: expect.stringContaining("null deref"),
    });
  });

  it("blocked: a BLOCKED: line or a waiting prompt fails it", () => {
    expect(gate(input({ blocked: "need the key" }), "blocked")).toMatchObject({
      state: "fail",
      reason: "the task is BLOCKED: need the key",
    });
    expect(gate(input({ waitingOn: "a prompt" }), "blocked").state).toBe(
      "fail"
    );
  });

  it("scope: rule breaks fail; a card task needs a passing scope check", () => {
    expect(
      gate(input({ ruleBreaks: ["it changes only lockfiles"] }), "scope")
    ).toMatchObject({
      state: "fail",
      reason: "it changes only lockfiles",
    });
    expect(gate(input({ fromCard: true }), "scope").state).toBe("wait");
    expect(
      gate(
        input({
          fromCard: true,
          scope: check({
            kind: "scope",
            status: "block",
            detail: "adds billing",
          }),
        }),
        "scope"
      )
    ).toMatchObject({
      state: "fail",
      reason: expect.stringContaining(
        'out of scope: <untrusted source="scope check">adds billing</untrusted>'
      ),
    });
    expect(
      gate(input({ fromCard: true, scope: check({ kind: "scope" }) }), "scope")
        .state
    ).toBe("pass");
  });

  it("stack: the parent must have merged", () => {
    expect(
      gate(input({ stackRefusal: "sign off ROA-1 first" }), "stack").state
    ).toBe("fail");
  });

  it("code-review: a PR body without a review of this commit fails", () => {
    expect(
      gate(
        input({ codeReviewRefusal: "no Code review section" }),
        "code-review"
      )
    ).toMatchObject({ state: "fail", reason: "no Code review section" });
  });
});

describe("the plain diff rules", () => {
  it("parses git's raw diff, marking symlinks", () => {
    expect(
      parseRaw(
        ":000000 100644 0000000 1111111 A\tsrc/a.ts\n:000000 120000 0000000 2222222 A\tlink"
      )
    ).toEqual([
      { path: "src/a.ts", status: "A" },
      { path: "link", status: "A", link: "" },
    ]);
  });

  it("sends CI, build, agent, deploy and secrets-handling files to Saad", () => {
    const files = [
      ".github/workflows/ci.yml",
      ".github/dependabot.yml",
      "docs/CODEOWNERS",
      "package.json",
      "web/Makefile",
      "client/Gemfile",
      "client/Gemfile.lock",
      "client/ios/Podfile",
      "client/.npmrc",
      "client/metro.config.js",
      "client/app.config.ts",
      "client/App.json",
      "client/eas.json",
      "client/babel.config.js",
      "client/babel.config.json",
      "client/.babelrc",
      "client/modules/native/native.podspec",
      "client/modules/native/expo-module.config.json",
      "client/react-native.config.js",
      "tools/x.gemspec",
      ".husky/pre-commit",
      ".githooks/pre-push",
      "lefthook.yml",
      ".gitmodules",
      ".claude/settings.json",
      ".agent-os.json",
      ".agent-os/worktrees.json",
      ".dispatch.json",
      "scripts/autodeploy",
      "scripts/publish",
      "DockerFile",
      ".env.production",
      "lib/secrets.ts",
      "lib/security/auth.ts",
      "app/api/pair/route.ts",
      "src/app.ts",
      "README.md",
      "lib/securityish.ts",
      "lib/tasks/code-review.ts",
      "scripts/check-code-review.ts",
      "lib/tasks/code-review.test.ts",
    ].map((p) => ({ path: p, status: "M" }));
    expect(sensitiveFiles(files).map((s) => `${s.path}:${s.why}`)).toEqual([
      ".github/workflows/ci.yml:CI config",
      ".github/dependabot.yml:CI config",
      "docs/CODEOWNERS:CI config",
      "package.json:build and hook scripts",
      "web/Makefile:build and hook scripts",
      "client/Gemfile:build and hook scripts",
      "client/Gemfile.lock:build and hook scripts",
      "client/ios/Podfile:build and hook scripts",
      "client/.npmrc:build and hook scripts",
      "client/metro.config.js:build and hook scripts",
      "client/app.config.ts:build and hook scripts",
      "client/App.json:build and hook scripts",
      "client/eas.json:build and hook scripts",
      "client/babel.config.js:build and hook scripts",
      "client/babel.config.json:build and hook scripts",
      "client/.babelrc:build and hook scripts",
      "client/modules/native/native.podspec:build and hook scripts",
      "client/modules/native/expo-module.config.json:build and hook scripts",
      "client/react-native.config.js:build and hook scripts",
      "tools/x.gemspec:build and hook scripts",
      ".husky/pre-commit:build and hook scripts",
      ".githooks/pre-push:build and hook scripts",
      "lefthook.yml:build and hook scripts",
      ".gitmodules:build and hook scripts",
      ".claude/settings.json:agent config",
      ".agent-os.json:agent config",
      ".agent-os/worktrees.json:agent config",
      ".dispatch.json:agent config",
      "scripts/autodeploy:deploy",
      "scripts/publish:deploy",
      "DockerFile:deploy",
      ".env.production:secrets handling",
      "lib/secrets.ts:secrets handling",
      "lib/security/auth.ts:secrets handling",
      "app/api/pair/route.ts:secrets handling",
      "lib/tasks/code-review.ts:the code review gate",
      "scripts/check-code-review.ts:the code review gate",
    ]);
  });

  it("breaks scope for lockfile-only changes, links out and secrets", () => {
    const f = (p: string, link?: string) => ({
      path: p,
      status: "A",
      ...(link !== undefined ? { link } : {}),
    });
    expect(ruleBreaks([f("package-lock.json")], "")).toEqual([
      "it changes only lockfiles",
    ]);
    expect(ruleBreaks([f("package-lock.json"), f("package.json")], "")).toEqual(
      []
    );
    expect(ruleBreaks([f("docs/x", "../../../etc/passwd")], "")).toEqual([
      "docs/x links outside the repository (to ../../../etc/passwd)",
    ]);
    expect(
      ruleBreaks(
        [f("a.ts")],
        'const k = "ghp_abcdefghijklmnopqrstuvwxyz123456";'
      )[0]
    ).toMatch(/adds what looks like a secret \(ghp_ab…\)/);
  });

  it("tells a secret from a setting or a placeholder", () => {
    expect(secretsIn("API_KEY=sk_live_8f7d6c5b4a3e2d1c")).toBe("API_KEY = …");
    expect(secretsIn("-----BEGIN RSA PRIVATE KEY-----")).toBe("a private key");
    for (const ok of [
      "MAX_TOKENS: 100",
      "API_KEY=${API_KEY}",
      "API_KEY=process.env.API_KEY",
      "AUTH_TOKEN=<your token>",
      "const sha = 'abc123';",
    ])
      expect(secretsIn(ok), ok).toBeNull();
  });
});
