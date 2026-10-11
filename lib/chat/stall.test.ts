import { describe, expect, it } from "vitest";
import { db } from "../db";
import {
  checkStallMinutes,
  setStallMinutes,
  STALL_KEY,
  stallMinutes,
} from "./stall";

describe("stall setting", () => {
  it("defaults to 8 minutes, stores a change, and 0 is off", () => {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(STALL_KEY);
    expect(stallMinutes()).toBe(8);
    setStallMinutes(15);
    expect(stallMinutes()).toBe(15);
    setStallMinutes(0);
    expect(stallMinutes()).toBe(0);
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(STALL_KEY);
  });

  it("accepts off or a whole number in range, and refuses the rest", () => {
    expect(checkStallMinutes(0)).toBe(0);
    expect(checkStallMinutes(2)).toBe(2);
    for (const bad of [1, 121, 2.5, "8", null, -1])
      expect(() => checkStallMinutes(bad)).toThrow();
  });
});
