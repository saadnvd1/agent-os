import { describe, expect, it } from "vitest";
import { artifactActions, pageActions } from "./actions";

const ids = (a: { id: string }[]) => a.map((x) => x.id);

describe("artifact actions", () => {
  it("gives a page full screen, share, open and download", () => {
    expect(ids(pageActions({ pdf: true }))).toEqual([
      "fullscreen",
      "share",
      "open",
      "download",
    ]);
    const download = (pdf: boolean) =>
      pageActions({ pdf }).find((a) => a.id === "download")?.formats;
    expect(download(true)).toEqual(["pdf", "html", "md"]);
    expect(download(false)).toEqual(["html", "md"]);
  });

  it("gives a gone page nothing", () => {
    expect(
      artifactActions({ kind: "page", state: "gone" }, { pdf: true })
    ).toEqual([]);
  });

  it("keeps a file's PR, copy-path and Files actions as they were", () => {
    const ctx = { pdf: false };
    expect(
      ids(artifactActions({ kind: "file", state: "live", path: "~/a" }, ctx))
    ).toEqual(["copy-path", "open-in-files"]);
    expect(
      ids(artifactActions({ kind: "file", state: "kept", path: "~/a" }, ctx))
    ).toEqual(["copy-path"]);
    expect(
      ids(artifactActions({ kind: "pr", state: "live", url: "https://x" }, ctx))
    ).toEqual(["open-pr"]);
  });
});

describe("compare action", () => {
  it("is offered only with two or more versions", () => {
    expect(ids(pageActions({ pdf: false }))).not.toContain("compare");
    expect(ids(pageActions({ pdf: false, versions: 1 }))).not.toContain(
      "compare"
    );
    expect(ids(pageActions({ pdf: false, versions: 2 }))).toEqual([
      "fullscreen",
      "share",
      "open",
      "compare",
      "download",
    ]);
  });
});
