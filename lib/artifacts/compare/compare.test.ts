import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createArtifact } from "../store";
import { pageVersions } from "../versions";
import { compareVersions, MAX_COMPARE_BYTES } from "./compareVersions";
import { diffLines, foldUnchanged, summaryLabel, MAX_LINES } from "./diff";
import { extractText } from "./extractText";
import { GET } from "@/app/api/sessions/[id]/artifacts/[artifactId]/compare/route";
import { tempDir } from "@/lib/test-temp";

beforeAll(() => {
  process.env.AGENTOS_ARTIFACTS_DIR = tempDir("agentos-compare-");
});

describe("extractText", () => {
  it("keeps the visible blocks one per line and drops scripts, styles and the head", () => {
    const html = `<!doctype html><html><head><title>Hidden</title><style>p{color:red}</style></head>
      <body><h1>Sales &amp; costs</h1><script>alert("x")</script>
      <p>First <b>bold</b> para</p><ul><li>one</li><li>two</li></ul>
      <table><tr><th>Q</th><td>10&nbsp;%</td></tr></table><!-- note --></body></html>`;
    expect(extractText(html)).toBe(
      ["Sales & costs", "First bold para", "one", "two", "Q", "10 %"].join("\n")
    );
  });

  it("decodes numeric entities and leaves unknown ones alone", () => {
    expect(extractText("<p>&#8212; &#x41; &bogus; &#99999999;</p>")).toBe(
      "— A &bogus; &#99999999;"
    );
  });
});

describe("diffLines", () => {
  it("counts added and removed lines", () => {
    const r = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne\nf");
    if (!r.ok) throw new Error("expected a diff");
    expect(r.summary).toEqual({ added: 3, removed: 1 });
    expect(summaryLabel(r.summary)).toBe("+3 −1 lines");
    expect(r.lines.filter((l) => l.t === "eq").map((l) => l.s)).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("marks the changed words inside a paired line", () => {
    const r = diffLines("Revenue grew 10 percent", "Revenue grew 14 percent");
    if (!r.ok) throw new Error("expected a diff");
    const del = r.lines.find((l) => l.t === "del")!;
    const add = r.lines.find((l) => l.t === "add")!;
    expect(del.words?.filter((w) => w.t === "del").map((w) => w.s)).toEqual([
      "10",
    ]);
    expect(add.words?.filter((w) => w.t === "add").map((w) => w.s)).toEqual([
      "14",
    ]);
  });

  it("handles empty sides and identical text", () => {
    const same = diffLines("x\ny", "x\ny");
    expect(same.ok && same.summary).toEqual({ added: 0, removed: 0 });
    expect(summaryLabel({ added: 0, removed: 0 })).toBe("No changes");
    const fresh = diffLines("", "x\ny");
    expect(fresh.ok && fresh.summary).toEqual({ added: 2, removed: 0 });
  });

  it("gives up past the line and edit limits", () => {
    const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => `l${i}`);
    expect(diffLines(many.join("\n"), "x").ok).toBe(false);
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join("\n");
    expect(diffLines(a, b).ok).toBe(false);
  });

  it("folds long unchanged stretches around the changes", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const r = diffLines(
      lines.join("\n"),
      lines.map((l) => (l === "l10" ? "X" : l)).join("\n")
    );
    if (!r.ok) throw new Error("expected a diff");
    const shown = foldUnchanged(r.lines, 2);
    expect(shown.filter((s) => "gap" in s)).toEqual([{ gap: 8 }, { gap: 7 }]);
  });
});

describe("compareVersions", () => {
  const page = (session = randomUUID()) => {
    const v1 = createArtifact(
      session,
      "Report",
      "<h1>Report</h1><p>10 sold</p>",
      {
        note: "first",
      }
    );
    const v2 = createArtifact(
      session,
      "Report",
      "<h1>Report</h1><p>14 sold</p><p>new</p>",
      {
        update: v1.id,
        note: "added the new row",
      }
    );
    return { session, v1, v2 };
  };

  it("diffs the visible text and carries both versions' notes", async () => {
    const { session, v1, v2 } = page();
    const r = await compareVersions(session, v1.id, v2.id, "changes");
    if (!r.ok || "tooLarge" in r) throw new Error("expected a diff");
    expect(r.summary).toEqual({ added: 2, removed: 1 });
    expect(r.from.note).toBe("first");
    expect(r.to.note).toBe("added the new row");
  });

  it("diffs the HTML source", async () => {
    const { session, v1, v2 } = page();
    const r = await compareVersions(session, v1.id, v2.id, "source");
    if (!r.ok || "tooLarge" in r) throw new Error("expected a diff");
    expect(r.lines.some((l) => l.t === "add" && l.s.includes("14 sold"))).toBe(
      true
    );
  });

  it("refuses another session's version", async () => {
    const mine = page();
    const theirs = page();
    for (const [a, b] of [
      [mine.v1.id, theirs.v1.id],
      [theirs.v1.id, mine.v1.id],
    ]) {
      expect(
        await compareVersions(mine.session, a, b, "changes")
      ).toMatchObject({
        ok: false,
        status: 404,
      });
    }
  });

  it("refuses versions of two different pages, and unknown ids", async () => {
    const { session, v1 } = page();
    const other = createArtifact(session, "Another page", "<p>x</p>");
    expect(
      await compareVersions(session, v1.id, other.id, "changes")
    ).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(
      await compareVersions(session, v1.id, randomUUID(), "changes")
    ).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("says too large past the size limit", async () => {
    const session = randomUUID();
    const big = `<p>${"x".repeat(MAX_COMPARE_BYTES)}</p>`;
    const v1 = createArtifact(session, "Big", big);
    const v2 = createArtifact(session, "Big", `${big}<p>y</p>`, {
      update: v1.id,
    });
    const r = await compareVersions(session, v1.id, v2.id, "changes");
    expect(r).toMatchObject({ ok: true, tooLarge: true });
  });

  it("lists compare only for a page with two or more versions", () => {
    const one = createArtifact(randomUUID(), "Solo", "<p>a</p>");
    const ids = (id: string) =>
      pageVersions(id, { pdf: false })!.actions.map((a) => a.id);
    expect(ids(one.id)).not.toContain("compare");
    const two = createArtifact(one.session_id, "Solo", "<p>b</p>", {
      update: one.id,
    });
    expect(ids(one.id)).toContain("compare");
    expect(ids(two.id)).toContain("compare");
  });
});

describe("GET /api/sessions/[id]/artifacts/[artifactId]/compare", () => {
  const call = (id: string, artifactId: string, query: string) =>
    GET(new Request(`http://x/compare${query}`), {
      params: Promise.resolve({ id, artifactId }),
    });

  it("needs ?to= and a session that exists", async () => {
    expect((await call("s", randomUUID(), "")).status).toBe(400);
    expect(
      (await call("nope", randomUUID(), `?to=${randomUUID()}`)).status
    ).toBe(404);
  });
});
