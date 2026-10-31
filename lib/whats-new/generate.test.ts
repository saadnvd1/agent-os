import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { tempDir } from "@/lib/test-temp";
import { parseCommit } from "./collect";
import { generate, type GenerateDeps } from "./generate";
import { lintText, readBlocklist } from "./lint";
import { WHATS_NEW_FILE } from "./load";
import { authorLine, parseAnswer } from "./summarize";

const SEP = "\x1f";
const log = (...rows: [number, string, string][]) =>
  rows.map(([n, d, s]) => `sha${n}${SEP}${d}T12:00:00Z${SEP}${s}`).join("\n");

function setup(
  commits: string,
  bodies: Record<number, string>,
  answer = "[]",
  blocklist: string[] = []
) {
  const root = tempDir("aos-whatsnew-");
  const ask = vi.fn(async () => answer);
  const deps: GenerateDeps = {
    git: (args) => (args[0] === "rev-parse" ? "headsha\n" : commits),
    prs: (numbers) =>
      new Map(
        numbers
          .filter((n) => n in bodies)
          .map((n) => [
            n,
            { body: bodies[n], url: `https://example.test/pull/${n}` },
          ])
      ),
    ask,
    blocklist,
  };
  const file = path.join(root, WHATS_NEW_FILE);
  return { root, deps, ask, file };
}

describe("authorLine", () => {
  it("reads the kind and sentence, or skip", () => {
    expect(
      authorLine("x\n\nWhats-new: Fixed — Done chats stay on the shelf")
    ).toEqual({
      kind: "fixed",
      text: "Done chats stay on the shelf.",
    });
    expect(authorLine("Whats-new: skip")).toEqual({ skip: true });
    expect(authorLine("Whats-new: Changed — nope")).toBeNull();
    expect(authorLine("no line here")).toBeNull();
  });
});

describe("parseCommit", () => {
  it("needs a type and a PR number", () => {
    expect(
      parseCommit(
        `a${SEP}2026-10-29T10:00:00-05:00${SEP}feat(live): Drive (#520)`
      )
    ).toMatchObject({
      type: "feat",
      scope: "live",
      title: "Drive",
      pr: 520,
      date: "2026-10-29",
    });
    expect(
      parseCommit(`a${SEP}2026-10-29T10:00:00Z${SEP}feat: no number`)
    ).toBeNull();
  });
});

describe("generate", () => {
  const commits = log(
    [5, "2026-10-29", "feat(live): access code for guests (#5)"],
    [4, "2026-10-29", "fix(security): close a hole (#4)"],
    [3, "2026-10-28", "chore: bump (#3)"],
    [2, "2026-10-28", "fix(chat): stop dropping replies (#2)"],
    [1, "2026-10-27", "feat(tasks): internal (#1)"]
  );

  it("uses the author's line, fills the rest from subjects alone, hides security and internals", async () => {
    const t = setup(
      commits,
      {
        5: "Long maintainer prose with internal detail.\n\nWhats-new: New — Guests can ask for an access code.",
        4: "Whats-new: Fixed — A thing.",
        2: "no line",
      },
      '[{"n":2,"kind":"fixed","text":"Replies no longer get lost in chat"}]'
    );
    const r = await generate(t.root, { sinceDays: 30, write: true }, t.deps);
    expect(r.added.map((e) => [e.id, e.kind, e.area, e.text])).toEqual([
      [2, "fixed", "Chat", "Replies no longer get lost in chat."],
      [5, "new", "Live sharing", "Guests can ask for an access code."],
    ]);
    const sent = (t.ask.mock.calls[0] as unknown as string[])[1];
    expect(sent).toContain("stop dropping replies");
    expect(sent).not.toContain("maintainer prose");
    expect(sent).not.toContain("access code");
    expect(JSON.parse(fs.readFileSync(t.file, "utf-8")).entries).toHaveLength(
      2
    );
  });

  it("never rewrites an id already in the file, and keeps hand edits", async () => {
    const t = setup(commits, { 5: "Whats-new: New — Fresh text." });
    fs.mkdirSync(path.dirname(t.file), { recursive: true });
    const mine = {
      id: 5,
      date: "2026-10-29",
      kind: "new",
      area: "Live sharing",
      text: "Hand written.",
      hidden: true,
      extra: 1,
    };
    fs.writeFileSync(t.file, JSON.stringify({ v: 1, entries: [mine] }));
    const r = await generate(t.root, { sinceDays: 30, write: true }, t.deps);
    expect(r.added.map((e) => e.id)).not.toContain(5);
    expect(JSON.parse(fs.readFileSync(t.file, "utf-8")).entries[0]).toEqual(
      mine
    );
  });

  it("makes no model call when every merge has a line, and writes nothing when empty", async () => {
    const t = setup(log([7, "2026-10-29", "feat(chat): x (#7)"]), {
      7: "Whats-new: skip",
    });
    const r = await generate(t.root, { sinceDays: 30, write: true }, t.deps);
    expect(t.ask).not.toHaveBeenCalled();
    expect(r.added).toEqual([]);
    expect(fs.existsSync(t.file)).toBe(false);
  });

  it("drops a line that names something on the private list", async () => {
    const t = setup(
      log([8, "2026-10-29", "feat(chat): x (#8)"]),
      { 8: "Whats-new: New — Works like Acme now." },
      "[]",
      ["Acme"]
    );
    const r = await generate(t.root, { sinceDays: 30, write: true }, t.deps);
    expect(r.added).toEqual([]);
    expect(r.dropped).toEqual([{ pr: 8, reason: "contains a blocked name" }]);
  });

  it("a dry run writes nothing", async () => {
    const t = setup(commits, {
      5: "Whats-new: New — Guests can ask for a code.",
    });
    await generate(t.root, { sinceDays: 30, write: false }, t.deps);
    expect(fs.existsSync(t.file)).toBe(false);
  });
});

describe("parseAnswer", () => {
  it("ignores prose around the array and bad shapes", () => {
    expect([
      ...parseAnswer('Sure!\n[{"n":1,"skip":true}] done').keys(),
    ]).toEqual([1]);
    expect(parseAnswer('[{"n":1,"kind":"huge","text":"x"}]').size).toBe(0);
    expect(parseAnswer("nothing").size).toBe(0);
  });
});

describe("lintText", () => {
  it.each([
    "See ~/projects/app for it.",
    "Edit components/Chat/Composer.tsx now.",
    "Runs on 10.0.0.12 now.",
    "Open box.example.io to see it.",
    "Reachable over your tailnet.",
    "Fixes CVE-2026-1234.",
    "Closes a vulnerability.",
    "Token ghp_abcdefghijklmnop leaked.",
    "Files under /Users/someone/work.",
  ])("refuses %s", (text) => {
    expect(lintText(text)).not.toBeNull();
  });

  it("allows plain sentences and single slash commands", () => {
    expect(
      lintText("Guests can ask for an access code before they join.")
    ).toBeNull();
    expect(lintText("Type /compact to shrink a long chat.")).toBeNull();
  });

  it("matches the private list whole-word, any case", () => {
    expect(lintText("Like ACME does", ["Acme"])).not.toBeNull();
    expect(lintText("Academic work", ["Acme"])).toBeNull();
  });
});

describe("readBlocklist", () => {
  it("creates an empty commented list when missing", () => {
    const file = path.join(tempDir("aos-blocklist-"), "list.txt");
    expect(readBlocklist(file)).toEqual([]);
    expect(fs.readFileSync(file, "utf-8").startsWith("#")).toBe(true);
    fs.appendFileSync(file, "Acme\n\n");
    expect(readBlocklist(file)).toEqual(["Acme"]);
  });
});
