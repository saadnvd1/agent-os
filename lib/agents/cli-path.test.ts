import { describe, expect, it } from "vitest";
import { skipDir } from "./cli-path";

describe("skipDir", () => {
  it("skips Windows-drive folders under WSL only", () => {
    expect(skipDir("/mnt/c/Users/me/AppData/Roaming/npm", 2)).toBe(true);
    expect(skipDir("/mnt/d", 1)).toBe(true);
    expect(skipDir("/home/me/.local/bin", 2)).toBe(false);
    expect(skipDir("/mnt/c/Users/me/npm", 0)).toBe(false);
    expect(skipDir("/mnt/data/bin", 2)).toBe(false);
  });
});
