import { describe, expect, it } from "vitest";
import { isGenericPayload } from "../copy";
import { CATEGORIES } from "../copy";
import { PUSH_CATEGORIES } from "../push-types";
import { collapseId, encodePush } from "./encode";
import { parseHidIdle, atMac } from "./presence";
import { foldsWhenAway, presenceGated, capExempt } from "./policy";

describe("encodePush", () => {
  it("builds the generic v1 envelope for every category, priority from its level", () => {
    for (const category of PUSH_CATEGORIES) {
      const e = encodePush({ category, id: "t-1", key: "k1" });
      expect(isGenericPayload(e.payload)).toBe(true);
      expect(e.level).toBe(CATEGORIES[category].level);
      expect(e.priority).toBe(e.level === "passive" ? 5 : 10);
      expect(e.threadId).toBe(category);
    }
  });

  it("the collapse id is a hash of the collapse key: stable, opaque, and shared by events that replace each other", () => {
    const a = encodePush({
      category: "ci",
      id: "t",
      key: "ci:t:aaa",
      collapse: "task:t",
    });
    const b = encodePush({
      category: "review",
      id: "t",
      key: "review:t:bbb",
      collapse: "task:t",
    });
    const c = encodePush({ category: "ci", id: "t", key: "ci:t:aaa" });
    expect(a.collapseId).toBe(b.collapseId);
    expect(a.collapseId).toBe(collapseId("task:t"));
    expect(a.collapseId).toMatch(/^[0-9a-f]{32}$/);
    expect(c.collapseId).not.toBe(a.collapseId);
    expect(a.collapseId).not.toContain("task");
  });

  it("keeps the event key out of the payload", () => {
    const e = encodePush({
      category: "ci",
      id: "t",
      key: "ci:t:0123456789abcdef0123456789abcdef01234567",
    });
    expect(JSON.stringify(e.payload)).not.toContain("0123456789abcdef");
  });
});

describe("quiet rules per category", () => {
  it("presence gates the ones he sees at the desk; asks, agents, system and digest are not gated", () => {
    expect(PUSH_CATEGORIES.filter(presenceGated)).toEqual([
      "needs-you",
      "review",
      "plan",
      "ci",
      "merged",
    ]);
  });
  it("Away folds everything but asks and the digest itself", () => {
    expect(PUSH_CATEGORIES.filter((c) => !foldsWhenAway(c))).toEqual([
      "asks",
      "digest",
    ]);
  });
  it("only asks are exempt from the cap", () => {
    expect(PUSH_CATEGORIES.filter(capExempt)).toEqual(["asks"]);
  });
});

describe("presence", () => {
  const out = (ns: number) => `    | |   "HIDIdleTime" = ${ns}\n`;
  it("reads seconds idle from ioreg output", () => {
    expect(parseHidIdle(out(2_500_000_000))).toBe(2.5);
    expect(parseHidIdle("nothing here")).toBeNull();
  });
  it("at the Mac under three minutes of idle, away after", async () => {
    expect(
      await atMac({ run: async () => out(60e9), platform: "darwin" })
    ).toBe(true);
    expect(
      await atMac({ run: async () => out(179e9), platform: "darwin" })
    ).toBe(true);
    expect(
      await atMac({ run: async () => out(181e9), platform: "darwin" })
    ).toBe(false);
  });
  it("a machine without a display, or a failed read, counts as away", async () => {
    expect(await atMac({ run: async () => out(1e9), platform: "linux" })).toBe(
      false
    );
    expect(
      await atMac({
        run: async () => {
          throw new Error("no ioreg");
        },
        platform: "darwin",
      })
    ).toBe(false);
    expect(
      await atMac({ run: async () => "garbled", platform: "darwin" })
    ).toBe(false);
  });
});
