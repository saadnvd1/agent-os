import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  artifactsDir,
  createArtifact,
  getArtifact,
  listArtifacts,
  readArtifactHtml,
} from "./store";
import { readSource, renderPage } from "./tools";
import type { Artifact } from "./store";

beforeAll(() => {
  process.env.AGENTOS_ARTIFACTS_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), "agentos-artifacts-")
  );
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-page-"));
    fs.writeFileSync(path.join(dir, "chart.html"), "<svg/>");
    expect(readSource({ path: "chart.html" }, dir)).toBe("<svg/>");
    expect(() => readSource({ path: "missing.html" }, dir)).toThrow(/No file/);
    expect(() => readSource({ html: "a", path: "b" }, dir)).toThrow(/either/);
  });
});
