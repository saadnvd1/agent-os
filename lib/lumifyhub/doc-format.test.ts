import { describe, expect, it } from "vitest";
import {
  contentHash,
  docTitle,
  escapeMarkdown,
  fromRepoNote,
  publishedMarkdown,
} from "./doc-format";

describe("docTitle", () => {
  it("takes an opening H1 as the title and drops it from the body", () => {
    expect(docTitle("# Plan\n\nShip it.\n", "docs/plan.md")).toEqual({
      title: "Plan",
      body: "Ship it.\n",
    });
  });

  it("keeps a later H1 in the body", () => {
    const md = "Intro\n\n# Plan\n\nShip it.";
    expect(docTitle(md, "a.md")).toEqual({ title: "Plan", body: md });
  });

  it("ignores headings inside code fences", () => {
    const md = "```sh\n# not a title\n```\n\nText";
    expect(docTitle(md, "docs/setup-guide.md").title).toBe("setup-guide");
  });

  it("falls back to the file name without its extension", () => {
    expect(docTitle("Just text", "notes/ROADMAP.markdown").title).toBe(
      "ROADMAP"
    );
  });

  it("skips frontmatter and closing hashes", () => {
    expect(docTitle("---\ntags: x\n---\n# Spec ##\nBody", "s.md")).toEqual({
      title: "Spec",
      body: "Body",
    });
  });

  it("ignores H2s", () => {
    expect(docTitle("## Section\n", "readme.md").title).toBe("readme");
  });
});

describe("fromRepoNote", () => {
  it("names the repo path and the project", () => {
    expect(fromRepoNote("docs/plan.md", "agent-os")).toBe(
      "*From* `docs/plan.md` *in agent-os. Edit it in the repo; changes here are overwritten.*"
    );
  });

  it("escapes markdown in the project name the way LumifyHub writes it", () => {
    expect(escapeMarkdown("my_app [beta]*")).toBe("my\\_app \\[beta\\]\\*");
    expect(fromRepoNote("a.md", "my_app")).toContain("in my\\_app.");
  });
});

describe("publishedMarkdown", () => {
  it("puts the note above the body", () => {
    const page = publishedMarkdown({
      markdown: "# Plan\n\nShip it.\n\n",
      fileName: "docs/plan.md",
      repoPath: "docs/plan.md",
      projectName: "web",
    });
    expect(page.title).toBe("Plan");
    expect(page.content).toBe(
      `${fromRepoNote("docs/plan.md", "web")}\n\nShip it.\n`
    );
  });

  it("publishes an empty file as just the note", () => {
    const page = publishedMarkdown({
      markdown: "",
      fileName: "empty.md",
      repoPath: "empty.md",
      projectName: "web",
    });
    expect(page).toEqual({
      title: "empty",
      content: `${fromRepoNote("empty.md", "web")}\n`,
    });
  });
});

describe("contentHash", () => {
  const page = { title: "Plan", content: "Ship it.\n" };

  it("is stable, short hex", () => {
    expect(contentHash(page)).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash({ ...page })).toBe(contentHash(page));
  });

  it("changes when the body or the title changes", () => {
    expect(contentHash({ ...page, content: "Ship it now.\n" })).not.toBe(
      contentHash(page)
    );
    expect(contentHash({ ...page, title: "Plan v2" })).not.toBe(
      contentHash(page)
    );
  });

  it("ignores trailing whitespace in the file once published", () => {
    const a = publishedMarkdown({
      markdown: "# T\n\nBody",
      fileName: "t.md",
      repoPath: "t.md",
      projectName: "p",
    });
    const b = publishedMarkdown({
      markdown: "# T\n\nBody\n\n\n",
      fileName: "t.md",
      repoPath: "t.md",
      projectName: "p",
    });
    expect(contentHash(a)).toBe(contentHash(b));
  });
});
