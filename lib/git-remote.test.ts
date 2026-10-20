import { describe, expect, it } from "vitest";
import { repoKeyOfRemote } from "./git-remote";

describe("repoKeyOfRemote", () => {
  it("gives ssh and https forms of one remote the same key", () => {
    const want = "github.com/acme/widgets";
    for (const url of [
      "https://github.com/Acme/Widgets.git",
      "git@github.com:acme/widgets.git",
      "ssh://git@github.com/acme/widgets",
      "https://user:secret@github.com/acme/widgets/",
    ])
      expect(repoKeyOfRemote(url)).toBe(want);
  });

  it("keeps other hosts and nested paths, drops the port", () => {
    expect(
      repoKeyOfRemote("https://git.example.test:8443/team/sub/app.git")
    ).toBe("git.example.test/team/sub/app");
    expect(repoKeyOfRemote("git@git.example.test:team/app")).toBe(
      "git.example.test/team/app"
    );
  });

  it("returns null for nothing usable", () => {
    for (const url of [
      "",
      null,
      undefined,
      "/local/path",
      "file:///x/y",
      "nonsense",
    ])
      expect(repoKeyOfRemote(url)).toBeNull();
  });
});
