import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedRoots, resolveAllowed, within } from "./access";
import { cleanPeerArtifact, peerContent, peerHeaders } from "./peer";

const tmp = () =>
  fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aos-acc-")));

describe("allowed roots", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never opens home or / whole, whatever folder a session started in", () => {
    // Tests run with HOME inside the temp folder, which is a root itself.
    const home = "/aos-home";
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const roots = allowedRoots({ working_directory: "~", worktree_path: "/" });
    expect(roots).not.toContain(home);
    expect(roots).not.toContain("/");
    expect(within(path.join(home, ".zshrc"), roots)).toBe(false);
  });

  it("includes the session's folders, by their real path too", () => {
    const dir = tmp();
    const roots = allowedRoots({ worktree_path: dir });
    expect(within(path.join(dir, "a.md"), roots)).toBe(true);
    expect(within("/aos-not-a-root/a.md", roots)).toBe(false);
  });
});

describe("resolveAllowed", () => {
  it("serves a regular file inside a root", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "a.md"), "hi");
    expect(resolveAllowed(path.join(dir, "a.md"), [dir])).toMatchObject({
      ok: true,
      size: 2,
    });
  });

  it("refuses outside the roots, a way out with .., a link out, and secrets", () => {
    const dir = tmp();
    const out = tmp();
    fs.writeFileSync(path.join(out, "x.md"), "x");
    fs.writeFileSync(path.join(out, "id_ed25519"), "k");
    fs.symlinkSync(path.join(out, "x.md"), path.join(dir, "link.md"));
    fs.symlinkSync(path.join(out, "id_ed25519"), path.join(dir, "key.md"));
    expect(resolveAllowed(path.join(out, "x.md"), [dir])).toEqual({
      ok: false,
      status: 403,
    });
    expect(
      resolveAllowed(path.join(dir, "../", path.basename(out), "x.md"), [dir])
    ).toEqual({ ok: false, status: 403 });
    expect(resolveAllowed(path.join(dir, "link.md"), [dir])).toEqual({
      ok: false,
      status: 403,
    });
    expect(resolveAllowed(path.join(dir, "key.md"), [dir, out])).toEqual({
      ok: false,
      status: 403,
    });
    expect(resolveAllowed(path.join(dir, ".env"), [dir])).toEqual({
      ok: false,
      status: 403,
    });
  });

  it("refuses a folder and what isn't there", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "sub"));
    expect(resolveAllowed(path.join(dir, "sub"), [dir])).toEqual({
      ok: false,
      status: 404,
    });
    expect(resolveAllowed(path.join(dir, "nope.md"), [dir])).toEqual({
      ok: false,
      status: 404,
    });
  });
});

describe("a linked machine's artifacts", () => {
  const good = {
    id: "0123456789abcdef",
    kind: "file",
    name: "a\u0007.md",
    at: 5,
    state: "live",
    preview: "markdown",
    url: "javascript:alert(1)",
    size: -1,
  };

  it("keeps only well-formed fields, cleaned", () => {
    expect(cleanPeerArtifact(good)).toEqual({
      id: "0123456789abcdef",
      kind: "file",
      name: "a .md",
      at: 5,
      state: "live",
      preview: "markdown",
    });
    expect(cleanPeerArtifact({ ...good, id: "../../x" })).toBeNull();
    expect(cleanPeerArtifact({ ...good, kind: "secret" })).toBeNull();
    expect(cleanPeerArtifact(null)).toBeNull();
  });

  it("re-serves only known types, with this machine's headers", () => {
    expect(
      peerHeaders("text/html; charset=utf-8")?.["Content-Security-Policy"]
    ).toContain("sandbox allow-scripts");
    expect(peerHeaders("image/png")?.["Content-Type"]).toBe("image/png");
    expect(peerHeaders("application/octet-stream")).toBeNull();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("forwards by id and refuses an answer it can't name", async () => {
    const link = {
      hostId: "h",
      hostName: "box",
      url: "http://peer",
      token: "t",
    };
    const fetch = vi.fn(
      async () =>
        new Response("<b>x</b>", { headers: { "content-type": "text/html" } })
    );
    vi.stubGlobal("fetch", fetch);
    const ok = await peerContent(link, "s1", "0123456789abcdef");
    expect(ok.ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://peer/api/sessions/s1/artifacts/0123456789abcdef",
      expect.objectContaining({ redirect: "error" })
    );
    expect((await peerContent(link, "s1", "../../etc")).ok).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x", { headers: { "content-type": "application/zip" } })
      )
    );
    expect(await peerContent(link, "s1", "0123456789abcdef")).toMatchObject({
      ok: false,
      status: 502,
    });
  });
});
