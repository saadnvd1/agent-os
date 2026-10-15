import { describe, expect, it } from "vitest";
import {
  indexPaths,
  mentionOption,
  mentionQuery,
  mentionText,
  rankPaths,
  scanPaths,
  withFolders,
} from "./mentions";

describe("mentionQuery", () => {
  it("opens on @ at the start of a line or after a space", () => {
    expect(mentionQuery("@")).toEqual({ query: "", start: 0 });
    expect(mentionQuery("look at @lib/ch")).toEqual({
      query: "lib/ch",
      start: 8,
    });
    expect(mentionQuery("one\ttwo @x")).toEqual({ query: "x", start: 8 });
  });

  it("ignores an @ inside a word, like an email address", () => {
    expect(mentionQuery("mail me@example.com")).toBeNull();
    expect(mentionQuery("foo@")).toBeNull();
  });

  it("closes once the mention ends with a space", () => {
    expect(mentionQuery("@lib/chat ")).toBeNull();
    expect(mentionQuery("@lib/chat and")).toBeNull();
  });

  it("reads a quoted path being typed", () => {
    expect(mentionQuery('see @"my fi')).toBeNull();
    expect(mentionQuery('see @"my')).toEqual({ query: "my", start: 4 });
  });

  it("isn't a mention with nothing before the caret", () => {
    expect(mentionQuery("")).toBeNull();
    expect(mentionQuery("plain text")).toBeNull();
  });
});

describe("mentionText", () => {
  it("writes a file as @path, a folder with its slash, then a space", () => {
    expect(mentionText({ path: "lib/chat/queue.ts", dir: false })).toBe(
      "@lib/chat/queue.ts "
    );
    expect(mentionText({ path: "lib/chat", dir: true })).toBe("@lib/chat/ ");
  });

  it("quotes a path with spaces", () => {
    expect(mentionText({ path: "docs/my notes.md", dir: false })).toBe(
      '@"docs/my notes.md" '
    );
  });
});

describe("rankPaths", () => {
  const files = withFolders([
    "lib/chat/queue.ts",
    "lib/chat/queued.ts",
    "components/Chat/Queue.tsx",
    "README.md",
  ]);

  it("lists folders a file list implies", () => {
    expect(files.filter((f) => f.dir).map((f) => f.path)).toEqual([
      "lib",
      "lib/chat",
      "components",
      "components/Chat",
    ]);
  });

  it("puts name matches first", () => {
    expect(rankPaths("queue", files).map((f) => f.path)).toEqual([
      "lib/chat/queue.ts",
      "components/Chat/Queue.tsx",
      "lib/chat/queued.ts",
    ]);
  });

  it("matches a path prefix and a fuzzy subsequence", () => {
    expect(rankPaths("lib/ch", files)[0].path).toBe("lib/chat");
    expect(rankPaths("rdme", files).map((f) => f.path)).toEqual(["README.md"]);
  });

  it("lists everything, shallow first, for a bare @", () => {
    expect(rankPaths("", files, 2).map((f) => f.path)).toEqual([
      "components",
      "lib",
    ]);
  });
});

describe("mentionOption", () => {
  it("is the name and its folder for a plain suggestion", () => {
    expect(mentionOption({ path: "lib/chat/queue.ts", dir: false })).toEqual({
      label: "queue.ts",
      hint: "lib/chat",
    });
    expect(mentionOption({ path: "lib", dir: true })).toEqual({
      label: "lib/",
      hint: undefined,
    });
  });

  it("leads the hint with the source for an orchestrator's", () => {
    expect(
      mentionOption({
        path: "/x/hq/docs/mission.md",
        dir: false,
        source: "HQ",
        rel: "docs/mission.md",
      })
    ).toEqual({ label: "mission.md", hint: "HQ · docs" });
    expect(
      mentionOption({
        path: "/x/app/README.md",
        dir: false,
        source: "app",
        rel: "README.md",
      })
    ).toEqual({ label: "README.md", hint: "app" });
    expect(
      mentionOption({ path: "/x/app", dir: true, source: "app", rel: "" })
    ).toEqual({ label: "app/", hint: "app" });
  });
});

describe("scanPaths", () => {
  const entries = (list: [string, number?][]) =>
    indexPaths(list.map(([path]) => ({ path, dir: false }))).map((p, i) => ({
      ...p,
      mtime: list[i][1],
    }));

  it("lists the most recently modified first among equal matches", () => {
    const top = scanPaths(
      "",
      entries([["a.ts", 100], ["b.ts", 300], ["c.ts", 200], ["d.ts"]])
    ).top.map((x) => x.p.file.path);
    expect(top).toEqual(["b.ts", "c.ts", "a.ts", "d.ts"]);
  });

  it("keeps a better match above a newer one", () => {
    const top = scanPaths(
      "queue",
      entries([
        ["lib/old-queue-helpers.ts", 900],
        ["lib/queue.ts", 1],
      ])
    ).top.map((x) => x.p.file.path);
    expect(top[0]).toBe("lib/queue.ts");
  });

  it("keeps what matched and counts what it looked at", () => {
    const all = entries([["notes.md"], ["other.md"], ["nope.md"]]);
    const scan = scanPaths("no", all, { keep: true });
    expect(scan.scanned).toBe(3);
    expect(scan.matches?.map((p) => p.file.path).sort()).toEqual([
      "nope.md",
      "notes.md",
    ]);
  });

  it("raises the score for a boosted folder, but not for an empty query", () => {
    const [a] = scanPaths("note", entries([["notes.md"]])).top;
    const [b] = scanPaths("note", entries([["notes.md"]]), { boost: 5 }).top;
    expect(b.s).toBe(a.s + 5);
    const [c] = scanPaths("", entries([["notes.md"]]), { boost: 5 }).top;
    expect(c.s).toBe(1);
  });
});
