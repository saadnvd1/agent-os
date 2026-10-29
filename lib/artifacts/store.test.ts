import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  artifactsDir,
  createArtifact,
  getArtifact,
  latestVersion,
  listArtifacts,
  listVersions,
  readArtifactHtml,
  saveArtifact,
} from "./store";
import { readSource, renderPage } from "./tools";
import type { Artifact } from "./store";
import { tempDir } from "@/lib/test-temp";

beforeAll(() => {
  process.env.AGENTOS_ARTIFACTS_DIR = tempDir("agentos-artifacts-");
});

describe("artifacts", () => {
  it("saves the page as a file in the session's folder, with a row", async () => {
    const session = randomUUID();
    const a = createArtifact(session, "  Sales\n by month ", "<p>hi</p>");
    expect(a.title).toBe("Sales by month");
    expect(a.path).toBe(path.join(artifactsDir(), session, `${a.id}.html`));
    expect(fs.readFileSync(a.path, "utf8")).toBe("<p>hi</p>");
    expect(getArtifact(a.id)).toEqual(a);
    expect(await readArtifactHtml(a)).toBe("<p>hi</p>");
  });

  it("lists a session's artifacts oldest first, and only its own", () => {
    const session = randomUUID();
    const first = createArtifact(session, "one", "1");
    const second = createArtifact(session, "two", "2");
    createArtifact(randomUUID(), "other", "3");
    expect(listArtifacts(session).map((a) => a.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("refuses an id that isn't a uuid, and a path outside the folder", async () => {
    expect(getArtifact("../../etc/passwd")).toBeUndefined();
    const a = createArtifact(randomUUID(), "x", "x");
    expect(await readArtifactHtml({ ...a, path: "/etc/hosts" })).toBeNull();
    expect(
      await readArtifactHtml({ ...a, path: `${artifactsDir()}-evil/x.html` })
    ).toBeNull();
  });

  it("keeps a session id from escaping the folder", () => {
    const a = createArtifact("../../escape", "x", "x");
    expect(path.dirname(a.path)).toBe(
      path.join(artifactsDir(), "______escape")
    );
  });

  it("refuses a page over 2 MB", () => {
    expect(() =>
      createArtifact(randomUUID(), "big", "x".repeat(2 * 1024 * 1024 + 1))
    ).toThrow(/over 2 MB/);
  });
});

describe("html_render", () => {
  it("saves the page and shows it in the conversation", async () => {
    const shown: Artifact[] = [];
    const ctx = {
      sessionId: randomUUID(),
      cwd: "/tmp",
      onRender: (a: Artifact) => shown.push(a),
    };
    const result = await renderPage(ctx, {
      html: "<h1>Chart</h1>",
      title: "Chart",
    });
    expect(result.isError).toBeUndefined();
    expect(shown).toHaveLength(1);
    expect(listArtifacts(ctx.sessionId)).toEqual(shown);
  });

  it("answers with an error and shows nothing for a bad call", async () => {
    const shown: Artifact[] = [];
    const ctx = {
      sessionId: randomUUID(),
      cwd: "/tmp",
      onRender: (a: Artifact) => shown.push(a),
    };
    const result = await renderPage(ctx, { title: "Nothing" });
    expect(result.isError).toBe(true);
    expect(shown).toHaveLength(0);
  });

  it("reads a page from a file relative to the working directory", () => {
    const dir = tempDir("agentos-page-");
    fs.writeFileSync(path.join(dir, "chart.html"), "<svg/>");
    expect(readSource({ path: "chart.html" }, dir)).toBe("<svg/>");
    expect(() => readSource({ path: "missing.html" }, dir)).toThrow(/No file/);
    expect(() => readSource({ html: "a", path: "b" }, dir)).toThrow(/either/);
  });
});

describe("versions", () => {
  it("adds a version to a page by id, and leaves every earlier one as it was", () => {
    const session = randomUUID();
    const v1 = createArtifact(session, "Signups", "<p>1</p>");
    const v2 = createArtifact(session, "Signups by plan", "<p>2</p>", {
      update: v1.id,
      note: "  split  by\nplan ",
    });
    expect(v1).toMatchObject({ page_id: v1.id, version: 1, note: null });
    expect(v2).toMatchObject({
      page_id: v1.id,
      version: 2,
      note: "split by plan",
      bytes: 8,
    });
    expect(v2.id).not.toBe(v1.id);
    expect(getArtifact(v1.id)).toEqual(v1);
    expect(fs.readFileSync(v1.path, "utf8")).toBe("<p>1</p>");
    expect(listVersions(v1.id).map((a) => a.version)).toEqual([1, 2]);
    expect(latestVersion(v1.id)?.id).toBe(v2.id);
  });

  it("matches the same title in the same chat only when asked", () => {
    const session = randomUUID();
    const a = createArtifact(session, "Report", "1");
    // Without sameTitle (other callers): a new page, as before.
    expect(createArtifact(session, "Report", "2").page_id).not.toBe(a.page_id);
    const next = saveArtifact(session, " report ", "3", { sameTitle: true });
    expect(next.created).toBe(true);
    expect(next.artifact.version).toBe(2);
    const other = saveArtifact(randomUUID(), "Report", "4", {
      sameTitle: true,
    });
    expect(other.artifact.version).toBe(1);
  });

  it("refuses to update another chat's page", () => {
    const a = createArtifact(randomUUID(), "Mine", "1");
    expect(() =>
      createArtifact(randomUUID(), "Theirs", "2", { update: a.id })
    ).toThrow(/No page/);
    expect(listVersions(a.page_id)).toHaveLength(1);
  });

  it("keeps a byte-identical render as the version it already is", () => {
    const session = randomUUID();
    const a = createArtifact(session, "Same", "<p>x</p>");
    const again = saveArtifact(session, "Same", "<p>x</p>", { update: a.id });
    expect(again).toEqual({ artifact: a, created: false });
    expect(listVersions(a.page_id)).toHaveLength(1);
  });

  it("numbers a burst of updates without gaps", () => {
    const session = randomUUID();
    const a = createArtifact(session, "Burst", "0");
    for (let i = 1; i <= 5; i++)
      createArtifact(session, "Burst", String(i), { update: a.id });
    expect(listVersions(a.page_id).map((v) => v.version)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});

describe("html_render versions", () => {
  it("shows a new version in the chat and says how to update it again", async () => {
    const shown: Artifact[] = [];
    const ctx = {
      sessionId: randomUUID(),
      cwd: "/tmp",
      onRender: (a: Artifact) => shown.push(a),
    };
    await renderPage(ctx, { html: "<p>1</p>", title: "Chart" });
    const r = await renderPage(ctx, {
      html: "<p>2</p>",
      title: "Chart",
      note: "Added Q4",
    });
    expect(shown.map((a) => a.version)).toEqual([1, 2]);
    expect(shown[1]).toMatchObject({ page_id: shown[0].id, note: "Added Q4" });
    const text = (r.content[0] as { text: string }).text;
    expect(text).toContain(`"Chart" v2`);
    expect(text).toContain(`update: "${shown[1].id}"`);
  });

  it("shows nothing new for an unchanged page", async () => {
    const shown: Artifact[] = [];
    const ctx = {
      sessionId: randomUUID(),
      cwd: "/tmp",
      onRender: (a: Artifact) => shown.push(a),
    };
    await renderPage(ctx, { html: "<p>1</p>", title: "Chart" });
    const r = await renderPage(ctx, { html: "<p>1</p>", title: "Chart" });
    expect(shown).toHaveLength(1);
    expect((r.content[0] as { text: string }).text).toMatch(/^Unchanged/);
  });

  it("answers with an error for an update to an unknown page", async () => {
    const r = await renderPage(
      { sessionId: randomUUID(), cwd: "/tmp", onRender: () => {} },
      { html: "x", title: "X", update: randomUUID() }
    );
    expect(r.isError).toBe(true);
  });
});
