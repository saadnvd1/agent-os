import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { tempDir } from "@/lib/test-temp";
import { loadBoxKey } from "./keys";

const root = tempDir("aos-peer-keys-");

const fresh = (name: string) => path.join(root, name);
const mode = (p: string) => fs.statSync(p).mode & 0o777;

describe.skipIf(process.platform === "win32")("peer.key", () => {
  it("is made owner-only, whole, and kept across loads", () => {
    const dir = fresh("new");
    const first = loadBoxKey(dir);
    expect(mode(dir)).toBe(0o700);
    expect(mode(path.join(dir, "peer.key"))).toBe(0o600);
    expect(loadBoxKey(dir).publicRaw).toBe(first.publicRaw);
    // No temp file left behind.
    expect(fs.readdirSync(dir)).toEqual(["peer.key"]);
  });

  it("repairs a key or folder others can read", () => {
    const dir = fresh("loose");
    const key = loadBoxKey(dir).publicRaw;
    fs.chmodSync(dir, 0o755);
    fs.chmodSync(path.join(dir, "peer.key"), 0o644);
    expect(loadBoxKey(dir).publicRaw).toBe(key);
    expect(mode(dir)).toBe(0o700);
    expect(mode(path.join(dir, "peer.key"))).toBe(0o600);
  });

  it("refuses a key that is a symlink", () => {
    const dir = fresh("link");
    loadBoxKey(fresh("elsewhere"));
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.symlinkSync(
      path.join(fresh("elsewhere"), "peer.key"),
      path.join(dir, "peer.key")
    );
    expect(() => loadBoxKey(dir)).toThrow(/symlink/);
  });
});
