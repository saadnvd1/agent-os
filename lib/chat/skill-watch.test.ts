import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSkillWatcher,
  skillFolders,
  type SkillWatcher,
} from "./skill-watch";
import { fakeFsWatch } from "./test-touch";
import { tempDir } from "@/lib/test-temp";

const tmp = () => fs.realpathSync(tempDir("skw-"));
let watcher: SkillWatcher | undefined;
let fake: ReturnType<typeof fakeFsWatch> | undefined;
afterEach(() => {
  watcher?.close();
  fake?.restore();
  fake = undefined;
  vi.useRealTimers();
});

// File events fired by hand and the settle delay on a fake clock: real
// events arrive when the OS likes, which under load is never in time.
function useFake() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return (fake = fakeFsWatch());
}

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

describe("createSkillWatcher", () => {
  it("reports a burst of changes once, after it settles", () => {
    // The events fired by hand: real ones arrive when the OS likes (macOS
    // even replays a new folder's own creation late).
    const fire: ((e: string, name: string) => void)[] = [];
    const spy = vi.spyOn(fs, "watch").mockImplementation(((
      _p: string,
      _o: unknown,
      listener: (e: string, name: string) => void
    ) => {
      fire.push(listener);
      return { on() {}, close() {} };
    }) as unknown as typeof fs.watch);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const calls = watched(tmp(), 300);
      expect(fire).toHaveLength(1);
      for (let i = 0; i < 5; i++) {
        fire[0]("rename", `c${i}.md`);
        vi.advanceTimersByTime(100);
      }
      expect(calls).toEqual([]);
      vi.advanceTimersByTime(300);
      expect(calls).toEqual(["claude:/p"]);
      // A later change is a reload of its own.
      fire[0]("change", "c0.md");
      vi.advanceTimersByTime(300);
      expect(calls).toEqual(["claude:/p", "claude:/p"]);
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });

  it("sees an edit inside a skill linked in as a symlink", () => {
    const dir = tmp();
    const real = tmp();
    fs.writeFileSync(path.join(real, "SKILL.md"), "one");
    fs.symlinkSync(real, path.join(dir, "linked"));
    const fake = useFake();
    const calls = watched(dir);
    expect(fake.at(dir, true)).toBeDefined();
    const link = fake.at(real, false);
    expect(link).toBeDefined();
    link!.fire("SKILL.md");
    vi.advanceTimersByTime(100);
    expect(calls).toEqual(["claude:/p"]);
  });

  it("sees a skill folder that didn't exist when watching started", () => {
    const project = tmp();
    const skills = path.join(project, ".claude", "skills");
    const fake = useFake();
    const calls = watched(skills);
    // Only the nearest folder that exists is watched, for the next name down.
    expect(fake.open().map((h) => h.path)).toEqual([project]);
    fake.at(project, false)!.fire(".claude");
    fs.mkdirSync(skills, { recursive: true });
    vi.advanceTimersByTime(100);
    expect(calls).toEqual(["claude:/p"]);
    // And now watches the folder itself, not the parent.
    expect(fake.at(project)).toBeUndefined();
    const own = fake.at(skills, true);
    expect(own).toBeDefined();
    own!.fire("skill-1");
    vi.advanceTimersByTime(100);
    expect(calls).toEqual(["claude:/p", "claude:/p"]);
  });

  it("ignores the rest of a parent folder it watches for one name", () => {
    const project = tmp();
    const fake = useFake();
    const calls = watched(path.join(project, ".claude", "skills"));
    const parent = fake.at(project, false)!;
    parent.fire("README.md");
    vi.advanceTimersByTime(10_000);
    expect(calls).toEqual([]);
    // An event with no name could be anything: it counts.
    parent.fire(null);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual(["claude:/p"]);
  });

  it("closes its watchers once no key reads the folder", () => {
    const dir = tmp();
    const real = tmp();
    fs.symlinkSync(real, path.join(dir, "linked"));
    const fake = useFake();
    const calls = watched(dir);
    // The folder and the linked skill, once each.
    expect(
      fake
        .open()
        .map((h) => h.path)
        .sort()
    ).toEqual([dir, real].sort());
    fake.at(dir)!.fire("x.md");
    vi.advanceTimersByTime(100);
    expect(calls).toEqual(["claude:/p"]);
    watcher!.release("claude:/p");
    expect(watcher!.keys()).toEqual([]);
    expect(fake.open()).toEqual([]);
    // A change still pending when the last key lets go reports nothing.
    calls.length = 0;
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
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
