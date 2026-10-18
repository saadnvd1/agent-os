import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionPath } from "./tool-path";
import { tempDir } from "@/lib/test-temp";

let home: string;
beforeEach(() => {
  home = tempDir("aos-path-");
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const mk = (...rel: string[]) =>
  rel.map((r) => {
    const p = path.join(home, r);
    fs.mkdirSync(p, { recursive: true });
    return p;
  });

const noBrew = (p: string) =>
  p.split(":").filter((d) => !d.startsWith("/opt/homebrew"));

describe("sessionPath", () => {
  it("puts existing tool dirs first, in order, and skips missing ones", () => {
    const [local, rbenv, cargo] = mk(
      ".local/bin",
      ".rbenv/shims",
      ".cargo/bin"
    );
    const got = sessionPath("/usr/bin:/bin", home, "/nowhere").split(":");
    expect(got.slice(0, 3)).toEqual([rbenv, local, cargo]);
    expect(got.slice(-2)).toEqual(["/usr/bin", "/bin"]);
    expect(got.some((d) => d.includes(".asdf"))).toBe(false);
  });

  it("does not repeat a dir already on the inherited PATH", () => {
    const [local] = mk(".local/bin");
    const got = noBrew(sessionPath(`/usr/bin:${local}:/bin`, home, "/nowhere"));
    expect(got).toEqual([local, "/usr/bin", "/bin"]);
  });

  it("drops the server's node_modules/.bin entries, not other repos'", () => {
    const got = noBrew(
      sessionPath(
        "/srv/app/node_modules/.bin:/srv/node_modules/.bin:/other/node_modules/.bin:/usr/bin",
        home,
        "/srv/app"
      )
    );
    expect(got).toEqual(["/other/node_modules/.bin", "/usr/bin"]);
  });
});
