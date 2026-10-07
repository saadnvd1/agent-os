import { describe, expect, it } from "vitest";
import { mentionQuery, mentionText, rankPaths, withFolders } from "./mentions";

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
