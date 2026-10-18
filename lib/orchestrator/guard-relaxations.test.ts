import fs from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { isOrchestratorSecretPath, isSecretPath } from "@/lib/secret-paths";
import { BUS_BRIEF } from "@/lib/agents/brief";
import { shellRefusal, addsExecute, type ShellContext } from "./shell-guard";
import { mangleCwd, writeRefusal, type WriteBounds } from "./write-guard";
import { tempDir } from "@/lib/test-temp";

let home: string;
let bounds: WriteBounds;
const at = (...p: string[]) => path.join(home, ...p);
const refused = (p: string) => writeRefusal(p, bounds);

beforeAll(() => {
  home = fs.realpathSync(tempDir("aos-gr-"));
  const cwd = at(".agent-os/orchestrators/w1");
  const mem = at(".claude/projects", mangleCwd(cwd), "memory");
  const otherMem = at(".claude/projects", mangleCwd("/x/other"), "memory");
  for (const d of [
    cwd,
    mem,
    otherMem,
    at(".claude/projects/elsewhere"),
    at(".agent-os/audits/sub"),
    at(".agent-os/orchestrators/w2"),
    at("notes"),
  ])
    fs.mkdirSync(d, { recursive: true });
  fs.symlinkSync(at(".zshrc"), `${mem}/zshrc-link`);
  fs.symlinkSync(at(".claude"), at("notes/claude-link"));
  fs.symlinkSync(at(".agent-os"), at("notes/state-link"));
  fs.symlinkSync(at("notes"), `${at(".agent-os/audits")}/out`);
  bounds = {
    cwd,
    ownDir: cwd,
    state: at(".agent-os"),
    repos: [at(".agent-os/worktrees"), at(".agent-os")],
    home,
    runs: [],
    memory: [mem],
    audits: at(".agent-os/audits"),
  };
});

const memDir = () =>
  at(".claude/projects", mangleCwd(at(".agent-os/orchestrators/w1")), "memory");

describe("its own auto-memory folder", () => {
  it("is writable, files and new subfolders", async () => {
    expect(await refused(`${memDir()}/note.md`)).toBeNull();
    expect(await refused(`${memDir()}/new/deep/note.md`)).toBeNull();
    expect(await refused(`${memDir()}/sub/../MEMORY.md`)).toBeNull();
  });

  it("is the only part of ~/.claude that is", async () => {
    const other = at(".claude/projects", mangleCwd("/x/other"), "memory");
    for (const p of [
      at(".claude/settings.json"),
      at(".claude/projects/elsewhere/memory/n.md"),
      `${other}/n.md`,
      at(
        ".claude/projects",
        mangleCwd(at(".agent-os/orchestrators/w1")),
        "n.md"
      ),
      at(".claude/projects", mangleCwd(at(".agent-os/orchestrators/w1"))),
      at(
        ".claude/projects",
        mangleCwd(at(".agent-os/orchestrators/w1")),
        "memory-x/n.md"
      ),
      at(".claude/projects"),
    ])
      expect(await refused(p), p).toMatch(/configures what runs/);
  });

  it("refuses `..` and symlink ways out", async () => {
    for (const p of [
      `${memDir()}/../n.md`,
      `${memDir()}/../../elsewhere/memory/n.md`,
      `${memDir()}/../../../settings.json`,
      `${memDir()}/zshrc-link`,
      at("notes/claude-link/settings.json"),
      at("notes/claude-link/projects/elsewhere/memory/n.md"),
    ])
      expect(await refused(p), p).not.toBeNull();
  });

  it("refuses files that run code even inside it", async () => {
    for (const f of ["CLAUDE.md", "AGENTS.md", ".git/config", ".envrc"])
      expect(await refused(`${memDir()}/${f}`), f).not.toBeNull();
  });

  it("is refused when the memory folder itself is a link elsewhere", async () => {
    const m = at(".claude/projects/linked/memory");
    fs.mkdirSync(at(".claude/projects/linked"), { recursive: true });
    fs.mkdirSync(at("notes/real-mem"));
    fs.symlinkSync(at("notes/real-mem"), m);
    const b = { ...bounds, memory: [m] };
    expect(await writeRefusal(`${m}/n.md`, b)).not.toBeNull();
    expect(await writeRefusal(at("notes/real-mem/n.md"), b)).toBeNull(); // plain notes
  });
});

describe("~/.agent-os/audits", () => {
  it("is writable", async () => {
    expect(await refused(at(".agent-os/audits/2026-10-16.md"))).toBeNull();
    expect(await refused(at(".agent-os/audits/new/dir/r.md"))).toBeNull();
    expect(await refused(at(".agent-os/audits/sub/../r.md"))).toBeNull();
  });

  it("leaves the rest of ~/.agent-os refused", async () => {
    for (const p of [
      at(".agent-os/audits-evil/r.md"),
      at(".agent-os/orchestrators/w2/r.md"),
      at(".agent-os/worktrees/x/r.md"),
      at(".agent-os/audits/../hooks.sh"),
      at(".agent-os/audits/sub/../../config.json"),
      at("notes/state-link/config.json"),
      at(".agent-os/audits/out/../../.agent-os/x"),
    ])
      expect(await refused(p), p).not.toBeNull();
  });

  it("refuses programs and git config in it", async () => {
    for (const f of ["x/.git/config", "CLAUDE.md", ".envrc", "x/.env"])
      expect(await refused(at(".agent-os/audits", f)), f).not.toBeNull();
  });

  it("is not a way out through a link inside it", async () => {
    expect(await refused(at(".agent-os/audits/out/ok.md"))).toBeNull(); // notes
    fs.symlinkSync(at(".zshrc"), at(".agent-os/audits/rc"));
    expect(await refused(at(".agent-os/audits/rc"))).not.toBeNull();
  });
});

describe("env templates", () => {
  it("exempts the three exact names only", () => {
    for (const p of [".env.example", "app/.env.sample", "/a/b/.env.template"]) {
      expect(isOrchestratorSecretPath(p), p).toBe(false);
      expect(isSecretPath(p), p).toBe(true); // the merge gate is unchanged
    }
    for (const p of [
      ".env",
      ".env.local",
      ".env.production",
      ".env.example.bak",
      ".env.examples",
      ".ENV.EXAMPLE",
      ".ssh/.env.example",
      "secrets/.env.example",
    ])
      expect(isOrchestratorSecretPath(p), p).toBe(true);
  });

  it("applies to the write guard", async () => {
    expect(await refused(at("notes/.env.example"))).toBeNull();
    expect(await refused(at("notes/.env.local"))).toMatch(/secrets/);
    expect(await refused(at("notes/.env.example.bak"))).toMatch(/secrets/);
  });
});

const inside = (p: string, root: string) =>
  p === root || p.startsWith(`${root}/`);
const ctx: ShellContext = {
  cwd: "/work/orch",
  writeRefusal: async (p) =>
    inside(p, "/work/repo") ? `${p} is inside a project repository.` : null,
  isAgentOsState: async () => false,
  inAudits: async (p) => inside(p, "/state/audits"),
  protectedPids: async () => new Set(),
};
const check = (c: string) => shellRefusal(c, ctx);

describe("shell guard", () => {
  it("allows read-only stash and nothing else of stash", async () => {
    for (const c of [
      "git -C /work/repo stash list",
      "git -C /work/repo stash show -p stash@{0}",
      "cd /work/repo && git stash show",
    ])
      expect(await check(c), c).toBeNull();
    for (const c of [
      "git -C /work/repo stash",
      "git -C /work/repo stash pop",
      "git -C /work/repo stash push -m x",
      "git -C /work/repo stash drop",
      "git -C /work/repo stash apply",
      "git -C /work/repo stash clear",
      "git -C /work/repo stash list; git -C /work/repo stash pop",
    ])
      expect(await check(c), c).toMatch(/Refused/);
  });

  it("still refuses pull, checkout and stash, with a message that teaches", async () => {
    for (const c of [
      "git -C /work/repo pull --ff-only",
      "cd /work/repo && git pull -q",
      "git -C /work/repo checkout main",
    ]) {
      const why = await check(c);
      expect(why, c).toMatch(/don't change project checkouts/);
      expect(why).toMatch(/git -C \/work\/repo fetch/);
      expect(why).toMatch(/show origin\/main:<path>/);
      expect(why).toMatch(/log origin\/main/);
      expect(why).not.toMatch(/is inside/);
    }
    expect(await check("git -C /work/repo fetch")).toBeNull();
    expect(await check("git -C /elsewhere pull")).toBeNull();
  });

  it("refuses making an audits file executable, and allows plain chmod", async () => {
    for (const c of [
      "chmod +x /state/audits/r.sh",
      "chmod a+x /state/audits/r.sh",
      "chmod 755 /state/audits/r.sh",
      "chmod 0701 /state/audits/r.sh",
      "chmod u=rwx /state/audits/r.sh",
      "chmod -R +x /state/audits",
      "chmod u+x,g-w /state/audits/r.sh",
      "chmod g=u /state/audits/r.sh",
    ])
      expect(await check(c), c).toMatch(/executable/);
    for (const c of [
      "chmod 644 /state/audits/r.md",
      "chmod 600 /state/audits/r.md",
      "chmod a-x /state/audits/r.md",
      "chmod +x /tmp/other.sh",
    ])
      expect(await check(c), c).toBeNull();
  });

  it("reads modes", () => {
    expect(addsExecute("644")).toBe(false);
    expect(addsExecute("u+rw")).toBe(false);
    expect(addsExecute("+x")).toBe(true);
    expect(addsExecute("")).toBe(true);
  });
});

describe("the write guard's wording", () => {
  it("names a repository once", async () => {
    const b = { ...bounds, repos: [at("dev/app")] };
    fs.mkdirSync(at("dev/app"), { recursive: true });
    const same = await writeRefusal(at("dev/app"), b);
    expect(same).toMatch(/^.*dev\/app is a project repository/);
    expect(same).not.toMatch(/is inside/);
    expect(await writeRefusal(at("dev/app/x.ts"), b)).toMatch(
      /x\.ts is inside .*dev\/app is a project repository/
    );
  });
});

describe("the brief", () => {
  it("carries the Python rule", () => {
    expect(BUS_BRIEF).toMatch(/uv run/);
    expect(BUS_BRIEF).toMatch(/~\/\.local\/bin\/uv/);
    expect(BUS_BRIEF).toMatch(/npm run pytest/);
    expect(BUS_BRIEF).toMatch(/Never a bare `python3`/);
    expect(BUS_BRIEF).toMatch(/pip install/);
    expect(BUS_BRIEF).toMatch(/mktemp/);
  });
});
