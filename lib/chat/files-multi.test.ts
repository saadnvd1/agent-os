import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  fallbackFileSuggestions,
  multiRootFileSuggestions,
  type MentionRoot,
} from "./files";
import { tempDir } from "@/lib/test-temp";

const hasRg = (() => {
  try {
    execFileSync("rg", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

// A git repository holding these files.
function repo(files: Record<string, string>): string {
  const dir = fs.realpathSync(tempDir("multi-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
const hq = (dir: string): MentionRoot => ({ dir, label: "HQ", hq: true });
const proj = (dir: string, label: string): MentionRoot => ({
  dir,
  label,
  hq: false,
});
const paths = (r: { path: string }[]) => r.map((x) => x.path);

describe("multiRootFileSuggestions", () => {
  it("returns absolute paths with their source and the path inside it", async () => {
    const h = repo({ "docs/mission.md": "" });
    const p = repo({ "lib/chat/files.ts": "" });
    const roots = [hq(h), proj(p, "agent-os")];
    expect(await multiRootFileSuggestions(roots, "mission")).toContainEqual({
      path: path.join(h, "docs/mission.md"),
      dir: false,
      source: "HQ",
      rel: "docs/mission.md",
    });
    expect(await multiRootFileSuggestions(roots, "files.ts")).toContainEqual({
      path: path.join(p, "lib/chat/files.ts"),
      dir: false,
      source: "agent-os",
      rel: "lib/chat/files.ts",
    });
  });

  it("finds a repository by its name", async () => {
    const p = repo({ "a.ts": "" });
    const found = await multiRootFileSuggestions(
      [proj(p, "zebra-app")],
      "zebra"
    );
    expect(found[0]).toEqual({
      path: p,
      dir: true,
      source: "zebra-app",
      rel: "",
    });
  });

  it("puts HQ first on a tie, but an exact name elsewhere still wins", async () => {
    const h = repo({ "notes.md": "", "notes-old.md": "" });
    const p = repo({ "notes.md": "", "src/notes-draft.md": "" });
    const roots = [hq(h), proj(p, "app")];
    const tie = await multiRootFileSuggestions(roots, "notes.md");
    expect(paths(tie.slice(0, 2))).toEqual([
      path.join(h, "notes.md"),
      path.join(p, "notes.md"),
    ]);
    const h2 = repo({ "notes-old.md": "" });
    const exact = await multiRootFileSuggestions(
      [hq(h2), proj(p, "app")],
      "notes.md"
    );
    expect(exact[0].path).toBe(path.join(p, "notes.md"));
  });

  it("leaves out secret files and ignored ones", async () => {
    const p = repo({
      ".gitignore": "ignored.txt\n",
      ".env": "K=v",
      ".env.local": "K=v",
      "keys/id_rsa": "",
      "keys/server.pem": "",
      "ignored.txt": "",
      "env-notes.md": "",
    });
    const all = await multiRootFileSuggestions([proj(p, "app")], "");
    const rels = all.map((f) => f.rel);
    expect(rels).toContain("env-notes.md");
    for (const secret of [
      ".env",
      ".env.local",
      "keys/id_rsa",
      "keys/server.pem",
      "ignored.txt",
    ])
      expect(rels).not.toContain(secret);
  });

  it("narrows: a longer query looks only at what the last one matched", async () => {
    const p = repo({
      "notes.md": "",
      "other.md": "",
      "zzz.md": "",
      "nope.md": "",
    });
    const roots = [proj(p, "app")];
    const first = { scanned: 0 };
    const second = { scanned: 0 };
    const third = { scanned: 0 };
    await multiRootFileSuggestions(roots, "no", "k1", first);
    await multiRootFileSuggestions(roots, "not", "k1", second);
    expect(second.scanned).toBeLessThan(first.scanned);
    // Not an extension of the last query: the whole index again.
    await multiRootFileSuggestions(roots, "zz", "k1", third);
    expect(third.scanned).toBe(first.scanned);
  });

  it("narrowing gives the same answer as a fresh scan", async () => {
    const p = repo({ "notes.md": "", "nope.md": "", "src/note.ts": "" });
    const roots = [proj(p, "app")];
    await multiRootFileSuggestions(roots, "no", "k2");
    const narrowed = await multiRootFileSuggestions(roots, "note", "k2");
    const fresh = await multiRootFileSuggestions(roots, "note", "other-key");
    expect(narrowed).toEqual(fresh);
  });

  it("answers an expired index from the old list while it rebuilds", async () => {
    const p = repo({ "first.md": "" });
    const roots = [proj(p, "app")];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      await multiRootFileSuggestions(roots, "md");
      fs.writeFileSync(path.join(p, "second.md"), "");
      vi.setSystemTime(Date.now() + 61_000);
      const stale = await multiRootFileSuggestions(roots, "md");
      expect(stale.map((f) => f.rel)).not.toContain("second.md");
      await vi.waitFor(async () =>
        expect(
          (await multiRootFileSuggestions(roots, "md")).map((f) => f.rel)
        ).toContain("second.md")
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers from the roots that are ready when one is missing", async () => {
    const p = repo({ "here.md": "" });
    const gone = path.join(p, "no-such-folder");
    const found = await multiRootFileSuggestions(
      [proj(gone, "gone"), proj(p, "app")],
      "here"
    );
    expect(found.map((f) => f.rel)).toContain("here.md");
  });

  it.skipIf(!hasRg)("lists the newest files first, across roots", async () => {
    const h = repo({ "old.md": "", "mid.md": "" });
    const p = repo({ "src/new.ts": "", "src/older.ts": "" });
    const at = (file: string, secondsAgo: number) => {
      const t = new Date(Date.now() - secondsAgo * 1000);
      fs.utimesSync(file, t, t);
    };
    at(path.join(h, "old.md"), 5000);
    at(path.join(h, "mid.md"), 300);
    at(path.join(p, "src/older.ts"), 1000);
    at(path.join(p, "src/new.ts"), 10);
    const found = await multiRootFileSuggestions([hq(h), proj(p, "app")], "");
    const files = found.filter((f) => !f.dir).map((f) => f.rel);
    expect(files).toEqual(["src/new.ts", "mid.md", "src/older.ts", "old.md"]);
  });

  it.skipIf(!hasRg)("keeps match quality above recency", async () => {
    const p = repo({ "report.md": "", "notes/archive-report-final.md": "" });
    const t = new Date(Date.now() + 60_000);
    fs.utimesSync(path.join(p, "notes/archive-report-final.md"), t, t);
    const found = await multiRootFileSuggestions([proj(p, "app")], "report.md");
    expect(found[0].rel).toBe("report.md");
  });
});

describe("fallbackFileSuggestions", () => {
  it("leaves out secret files too, for every session", async () => {
    const p = repo({
      ".env": "K=v",
      "config/credentials.json": "",
      "keys/id_ed25519": "",
      "src/app.ts": "",
    });
    const found = await fallbackFileSuggestions(p, "");
    const listed = paths(found);
    expect(listed).toContain("src/app.ts");
    for (const secret of [".env", "config/credentials.json", "keys/id_ed25519"])
      expect(listed).not.toContain(secret);
  });

  it("is otherwise as it was: relative paths, no source, no recency", async () => {
    const p = repo({ "src/app.ts": "" });
    const found = await fallbackFileSuggestions(p, "app");
    expect(found).toEqual([{ path: "src/app.ts", dir: false }]);
  });
});
