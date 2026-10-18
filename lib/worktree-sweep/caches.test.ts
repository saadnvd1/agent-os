import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { findCacheLeftovers, type CacheDeps } from "./caches";
import { SESSION_TMP_PREFIX } from "@/lib/sessions/leftovers";
import { tempDir } from "@/lib/test-temp";

const DAY = 24 * 3600_000;

function setup() {
  const base = tempDir("aos-caches-");
  const dir = (...p: string[]) => {
    const d = path.join(base, ...p);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const age = (d: string, days: number) => {
    const t = new Date(Date.now() - days * DAY);
    fs.utimesSync(d, t, t);
    return d;
  };
  const plist: Record<string, string> = {};
  const deps = (live: string[] = []): CacheDeps => ({
    now: Date.now(),
    spareRoot: path.join(base, "spare"),
    tmpRoot: path.join(base, "tmp"),
    derivedRoot: path.join(base, "derived"),
    worktreesRoot: path.join(base, "worktrees"),
    liveIds: new Set(live),
    workspaceOf: async (d) => plist[path.basename(d)] ?? null,
    size: async () => 5,
  });
  return { base, dir, age, plist, deps };
}

const names = async (d: CacheDeps) =>
  (await findCacheLeftovers(d)).candidates.map((c) => path.basename(c.path));

describe("cache leftovers", () => {
  it("takes a spare unused for a week and an abandoned build, not a fresh one", async () => {
    const t = setup();
    t.age(t.dir("spare", "aaa-111"), 10);
    t.age(t.dir("spare", "bbb-222"), 1);
    t.age(t.dir("spare", "ccc-333.99-1"), 1);
    t.dir("spare", "ddd-444.99-2");
    // The day-old build was abandoned; the one just started stays.
    expect((await names(t.deps())).sort()).toEqual(["aaa-111", "ccc-333.99-1"]);
  });

  it("takes a dead task's temp folder but not a running one's or a young one", async () => {
    const t = setup();
    t.age(t.dir("tmp", `${SESSION_TMP_PREFIX}deadbeef`), 3);
    t.age(t.dir("tmp", `${SESSION_TMP_PREFIX}1ive1234-aaaa-bbbb`), 3);
    t.age(t.dir("tmp", `${SESSION_TMP_PREFIX}ffffffff`), 0);
    // Same first eight characters as a running session, but another session.
    t.age(t.dir("tmp", `${SESSION_TMP_PREFIX}1ive1234-cccc-dddd`), 3);
    t.age(t.dir("tmp", "agentos-preview-x1"), 3);
    t.age(t.dir("tmp", "agentos-preview-x2"), 0);
    t.age(t.dir("tmp", "somebody-elses"), 30);
    const d = t.deps(["1ive1234-aaaa-bbbb"]);
    expect((await names(d)).sort()).toEqual([
      "agentos-preview-x1",
      `${SESSION_TMP_PREFIX}1ive1234-cccc-dddd`,
      `${SESSION_TMP_PREFIX}deadbeef`,
    ]);
    const { skipped } = await findCacheLeftovers(d);
    expect(skipped.map((s) => s.reason)).toEqual(["its session is running"]);
  });

  it("takes build folders of worktrees that are gone, only inside the worktrees root", async () => {
    const t = setup();
    const live = t.dir("worktrees", "still-here");
    t.dir("derived", "Gone-1");
    t.dir("derived", "Here-2");
    t.dir("derived", "Mine-3");
    t.plist["Gone-1"] = path.join(t.base, "worktrees", "removed-one");
    t.plist["Here-2"] = live;
    t.plist["Mine-3"] = path.join(t.base, "Projects", "my-own-app");
    expect(await names(t.deps())).toEqual(["Gone-1"]);
  });

  it("takes test temp folders a day old, not fresh ones or other names", async () => {
    const t = setup();
    t.age(t.dir("tmp", "agent-os-test-old"), 3);
    t.age(t.dir("tmp", "aos-orch-repo-old"), 3);
    t.age(t.dir("tmp", "aos-t-oldrun"), 3);
    t.age(t.dir("tmp", "aos-orch-repo-new"), 0);
    t.age(t.dir("tmp", "aos-snap-old"), 3);
    t.age(t.dir("tmp", "agent-os-screenshots"), 3);
    t.age(t.dir("tmp", "other-old"), 30);
    const { candidates } = await findCacheLeftovers(t.deps());
    expect(
      candidates.map((c) => [path.basename(c.path), c.kind]).sort()
    ).toEqual([
      ["agent-os-test-old", "test-temp"],
      ["aos-orch-repo-old", "test-temp"],
      ["aos-t-oldrun", "test-temp"],
    ]);
  });

  it("finds nothing where the folders don't exist", async () => {
    const t = setup();
    expect(await names(t.deps())).toEqual([]);
  });
});
