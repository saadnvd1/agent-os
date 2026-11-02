import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { forkToolGuard, type ForkGuardContext } from "./guard";

let shared: ForkGuardContext;
let own: ForkGuardContext;
let root: string;

beforeAll(() => {
  root = fs.realpathSync(tempDir("aos-fork-guard-"));
  const parent = path.join(root, "parent");
  const scratch = path.join(root, "scratch");
  const wt = path.join(root, "wt");
  for (const d of [parent, scratch, wt]) fs.mkdirSync(d);
  fs.mkdirSync(path.join(wt, "node_modules"));
  shared = { parentCheckout: parent, scratch, ownCheckout: null, cwd: parent };
  own = { parentCheckout: parent, scratch, ownCheckout: wt, cwd: wt };
});

const bash = (c: ForkGuardContext, command: string) =>
  forkToolGuard(c)("Bash", { command });
const refused = async (c: ForkGuardContext, command: string) => {
  const why = await bash(c, command);
  expect(typeof why === "string" ? why : `ALLOWED: ${command}`).toMatch(
    /^Refused/
  );
};
const allowed = async (c: ForkGuardContext, command: string) =>
  expect(await bash(c, command)).toBeNull();

describe("a fork child in the parent's checkout", () => {
  it("reads freely, and writes to its scratch folder", async () => {
    for (const cmd of [
      "ls -la && cat package.json | head -5",
      "rg 'Money' lib | wc -l",
      "git log --oneline -5 && git diff HEAD && git status --short",
      "git branch --list && git tag -l",
      `echo hi > ${shared.scratch}/repro.txt`,
      "echo hi > $AOS_SCRATCH/repro.txt",
      "mkdir -p $AOS_SCRATCH/a && cp package.json $AOS_SCRATCH/a/",
      "node $AOS_SCRATCH/repro.mjs",
      "aos heavy -- npm test",
      "npx vitest run lib/billing/money.test.ts",
      "aos return 'done' --details -",
    ])
      await allowed(shared, cmd);
  });

  it("can't write the parent's files through a file tool", async () => {
    const guard = forkToolGuard(shared);
    for (const tool of ["Write", "Edit", "MultiEdit"])
      expect(
        await guard(tool, {
          file_path: path.join(shared.parentCheckout, "a.ts"),
        })
      ).toMatch(/Refused.*parent's checkout.*AOS_SCRATCH/);
    expect(await guard("NotebookEdit", { notebook_path: "x.ipynb" })).toMatch(
      /^Refused/
    );
    expect(
      await guard("Write", { file_path: path.join(shared.scratch, "n.md") })
    ).toBeNull();
    expect(
      await guard("Write", { file_path: path.join(root, "elsewhere.md") })
    ).toBeNull();
  });

  it("sees through a symlink into the checkout", async () => {
    const link = path.join(shared.scratch, "into-parent");
    fs.symlinkSync(shared.parentCheckout, link);
    expect(
      await forkToolGuard(shared)("Write", {
        file_path: path.join(link, "a.ts"),
      })
    ).toMatch(/^Refused/);
  });

  it("can't change files, the index or refs from the shell", async () => {
    for (const cmd of [
      "echo x > a.ts",
      `echo x >> ${shared.parentCheckout}/a.ts`,
      "rm -rf lib",
      "mv a.ts b.ts",
      "touch new.ts",
      "cp $AOS_SCRATCH/x.ts lib/x.ts",
      "sed -i 's/a/b/' a.ts",
      "perl -pi -e 's/a/b/' a.ts",
      "git checkout -- a.ts",
      "git add -A",
      "git commit -m x",
      "git stash",
      "git reset --hard",
      "git -C . clean -fd",
      "bash -c 'rm a.ts'",
      "env FOO=1 rm a.ts",
      "find . -name '*.log' -delete",
      "tee a.ts < /dev/null",
      "npm install left-pad",
      "pnpm add x",
      "npx vitest run -u",
      "git branch -D old",
      "git tag v1",
      "git update-ref -d refs/heads/x",
      "echo ok && echo x > a.ts",
    ])
      await refused(shared, cmd);
    expect(await bash(shared, "touch a.ts")).toMatch(/--worktree/);
  });

  it("follows a cd", async () => {
    await refused(
      shared,
      `cd ${shared.scratch} && cd ${shared.parentCheckout} && touch a`
    );
    await allowed(
      shared,
      `cd ${shared.scratch} && touch a && git status 2>/dev/null; true`
    );
    await allowed(shared, `cd ${shared.scratch} && echo x > a.txt`);
  });

  it("can't ship, push or fork", async () => {
    for (const cmd of [
      "git push origin HEAD",
      "gh pr create --fill",
      "gh pr merge 5",
      "aos fork 'a' 'b'",
      "cd /tmp && aos fork a",
    ])
      await refused(shared, cmd);
    await allowed(shared, "gh pr view 5 && gh pr diff 5");
  });

  it("sends whole builds and suites through aos heavy", async () => {
    for (const cmd of [
      "npm test",
      "npm run typecheck",
      "npx vitest run",
      "tsc --noEmit",
      "next build",
      "cd $AOS_SCRATCH && npm test",
      "bash -c 'npm run build'",
    ])
      expect(await bash(shared, cmd)).toMatch(/aos heavy/);
    await allowed(shared, "aos heavy -- npm test");
    await allowed(shared, "aos heavy -- npx vitest run");
    await allowed(shared, "npm test -- lib/fork/guard.test.ts");
  });

  it("reads a command it can't parse as a refusal", async () => {
    expect(await bash(shared, "")).toMatch(/^Refused/);
    expect(await bash(shared, "echo $(")).toMatch(/^Refused/);
  });
});

describe("a fork child with its own checkout", () => {
  it("edits there, still not in the parent's", async () => {
    const guard = forkToolGuard(own);
    expect(
      await guard("Edit", { file_path: path.join(own.ownCheckout!, "a.ts") })
    ).toBeNull();
    expect(
      await guard("Edit", { file_path: path.join(own.parentCheckout, "a.ts") })
    ).toMatch(/^Refused/);
    await allowed(
      own,
      "sed -i 's/a/b/' a.ts && git add -A && git commit -m wip"
    );
    await allowed(own, "git status && git diff > $AOS_SCRATCH/fix.diff");
    await refused(own, `rm ${own.parentCheckout}/a.ts`);
    await refused(own, `git -C ${own.parentCheckout} checkout .`);
  });

  it("still can't push, open a PR, move a ref or fork", async () => {
    for (const cmd of [
      "git push",
      "gh pr create",
      "git branch -f main HEAD",
      "git stash",
      "git worktree remove --force .",
      "aos fork x",
    ])
      await refused(own, cmd);
  });

  it("won't install through a link to the parent's packages", async () => {
    await allowed(own, "npm install");
    fs.rmSync(path.join(own.ownCheckout!, "node_modules"), { recursive: true });
    fs.symlinkSync(
      path.join(own.parentCheckout, "node_modules"),
      path.join(own.ownCheckout!, "node_modules")
    );
    await refused(own, "npm install");
    await allowed(own, "aos heavy -- npm test");
  });
});
