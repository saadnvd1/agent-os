import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSkillWatcher,
  skillFolders,
  type SkillWatcher,
} from "./skill-watch";
import { sleep, touchUntil } from "./test-touch";

const tmp = () =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skw-")));
// macOS's file events take a moment to start after a watch is opened.
const WARM = 700;

const watchReal = fs.watch.bind(fs);

let watcher: SkillWatcher | undefined;
afterEach(() => watcher?.close());

function watched(folder: string, debounceMs = 100) {
  const calls: string[] = [];
  watcher = createSkillWatcher((k) => calls.push(k), debounceMs);
  watcher.watch("claude:/p", [folder]);
  return calls;
}

describe("skillFolders", () => {
  it("lists the user's and the project's skill and command folders", () => {
    expect(skillFolders("/p", "/h")).toEqual([
      "/h/skills",
      "/h/commands",
      "/p/.claude/skills",
      "/p/.agents/skills",
      "/p/.claude/commands",
    ]);
  });
});

describe("createSkillWatcher", { timeout: 45_000 }, () => {
  it("reports a burst of changes once, after it settles", async () => {
    const dir = tmp();
    const calls = watched(dir, 500);
    await sleep(WARM);
    let round = 0;
    const bursts = await touchUntil(
      () => {
        round++;
        for (let i = 0; i < 5; i++)
          fs.writeFileSync(path.join(dir, `c${i}.md`), String(round));
      },
      () => calls.length > 0
    );
    await sleep(1000);
    // Five writes, one reload (per burst, should one have gone unseen).
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.length).toBeLessThanOrEqual(bursts);
    expect(new Set(calls)).toEqual(new Set(["claude:/p"]));
  });

  it("sees an edit inside a skill linked in as a symlink", async () => {
    const dir = tmp();
    const real = tmp();
    fs.writeFileSync(path.join(real, "SKILL.md"), "one");
    fs.symlinkSync(real, path.join(dir, "linked"));
    const calls = watched(dir);
    await sleep(WARM);
    let n = 0;
    await touchUntil(
      () => fs.writeFileSync(path.join(real, "SKILL.md"), String(++n)),
      () => calls.length > 0
    );
  });

  it("sees a skill folder that didn't exist when watching started", async () => {
    const project = tmp();
    const skills = path.join(project, ".claude", "skills");
    const calls = watched(skills);
    await sleep(WARM);
    await touchUntil(
      () => {
        fs.rmSync(path.join(project, ".claude"), {
          recursive: true,
          force: true,
        });
        fs.mkdirSync(skills, { recursive: true });
      },
      () => calls.length > 0
    );
    // And now watches the folder itself.
    calls.length = 0;
    await sleep(WARM);
    let n = 0;
    await touchUntil(
      () => fs.mkdirSync(path.join(skills, `skill-${++n}`)),
      () => calls.length > 0
    );
  });

  it("ignores the rest of a parent folder it watches for one name", async () => {
    const project = tmp();
    const calls = watched(path.join(project, ".claude", "skills"));
    await sleep(WARM);
    fs.writeFileSync(path.join(project, "README.md"), "x");
    await sleep(2000);
    expect(calls).toEqual([]);
  });

  it("closes its watchers once no key reads the folder", async () => {
    const dir = tmp();
    const real = tmp();
    fs.symlinkSync(real, path.join(dir, "linked"));
    const opened: fs.FSWatcher[] = [];
    const spy = vi.spyOn(fs, "watch").mockImplementation(((
      ...args: Parameters<typeof fs.watch>
    ) => {
      const w = watchReal(...args);
      opened.push(w);
      vi.spyOn(w, "close");
      return w;
    }) as typeof fs.watch);
    try {
      const calls = watched(dir);
      expect(opened).toHaveLength(2); // the folder and the linked skill
      await sleep(WARM);
      await touchUntil(
        () => fs.writeFileSync(path.join(dir, "x.md"), String(Math.random())),
        () => calls.length > 0
      );
      watcher!.release("claude:/p");
      expect(watcher!.keys()).toEqual([]);
      for (const w of opened) expect(w.close).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("re-arms on each watch, so a missed event doesn't leave it blind", () => {
    const project = tmp();
    const skills = path.join(project, ".claude", "skills");
    const spy = vi.spyOn(fs, "watch");
    try {
      watched(skills);
      expect(spy).not.toHaveBeenCalledWith(
        skills,
        expect.anything(),
        expect.anything()
      );
      // Made with no event seen; the next load watches it all the same.
      fs.mkdirSync(skills, { recursive: true });
      watcher!.watch("claude:/p", [skills]);
      expect(spy).toHaveBeenCalledWith(
        skills,
        { recursive: true },
        expect.any(Function)
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("skips a folder it can't watch", () => {
    watcher = createSkillWatcher(() => {});
    expect(() => watcher!.watch("k", ["/nonexistent/a/b/c"])).not.toThrow();
  });
});
