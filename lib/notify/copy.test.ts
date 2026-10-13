import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  buildPushPayload,
  defaultCategories,
  enabledCategories,
  isGenericPayload,
  parsePushEnvelope,
} from "./copy";
import { PUSH_CATEGORIES } from "./push-types";
import { looksSecret, safeId, safeKey, scrubText } from "./redact";

// Built at runtime so no token-shaped literal sits in the source.
const fake = {
  aosd: () => "aosd" + "_" + "a1B2".repeat(11),
  sk: () => "sk" + "-" + "proj1234".repeat(3),
  ghp: () => "gh" + "p_" + "x9Y8".repeat(9),
  akia: () => "AK" + "IA" + "ABCDEFGH12345678",
  jwt: () =>
    ["eyJ" + "hbGciOi", "eyJzdWIi" + "OiIxIn0", "sig" + "nature1"].join("."),
  hex: () => "0123456789abcdef".repeat(2),
};

describe("category registry", () => {
  it("covers every category with a fixed word and a link", () => {
    for (const c of PUSH_CATEGORIES) {
      const def = CATEGORIES[c];
      expect(def.word.length).toBeGreaterThan(0);
      expect(def.link(null)).toMatch(/^\//);
    }
  });

  it("defaults to everything except merged", () => {
    expect(defaultCategories()).not.toContain("merged");
    expect(defaultCategories()).toContain("asks");
  });

  it("enabledCategories falls back to defaults and drops unknown names", () => {
    expect(enabledCategories(null)).toEqual(defaultCategories());
    expect(enabledCategories(["merged", "gone", "asks"])).toEqual([
      "asks",
      "merged",
    ]);
    expect(enabledCategories([])).toEqual([]);
  });
});

describe("buildPushPayload", () => {
  it("is generic: fixed title, category word, deep link, level", () => {
    expect(
      buildPushPayload({ category: "asks", id: "ws-1", key: "ask:7" })
    ).toEqual({
      v: 1,
      c: "asks",
      t: "AgentOS",
      b: "Needs your call",
      l: "/orchestrator?workspaceId=ws-1",
      k: "ask:7",
      p: "time-sensitive",
    });
    expect(buildPushPayload({ category: "needs-you", id: "s_9" }).l).toBe(
      "/session/s_9"
    );
    expect(buildPushPayload({ category: "review", id: "t1" }).l).toBe(
      "/task/t1"
    );
    expect(buildPushPayload({ category: "system" }).l).toBe("/machines");
  });

  it("falls back to /needs when the id is missing or unsafe", () => {
    for (const id of [null, undefined, "", "a/b", "x y", "../etc", fake.aosd()])
      expect(buildPushPayload({ category: "needs-you", id }).l).toBe("/needs");
  });

  it("never lets a secret or free text through the id or key", () => {
    for (const bad of [
      fake.aosd(),
      fake.sk(),
      fake.ghp(),
      fake.akia(),
      fake.jwt(),
      fake.hex(),
    ]) {
      const p = buildPushPayload({ category: "ci", id: bad, key: bad });
      expect(JSON.stringify(p)).not.toContain(bad);
      expect(isGenericPayload(p)).toBe(true);
    }
    const p = buildPushPayload({
      category: "agents",
      id: "ok",
      key: "line one\nrm -rf /",
    });
    expect(p.k).toBe("agents:ok");
  });

  it("every category and a spread of ids produce a payload the guard accepts", () => {
    for (const c of PUSH_CATEGORIES)
      for (const id of [undefined, "abc", "a-b_c", "x".repeat(65)])
        expect(isGenericPayload(buildPushPayload({ category: c, id }))).toBe(
          true
        );
  });
});

describe("isGenericPayload", () => {
  const ok = () => buildPushPayload({ category: "review", id: "t1" });
  it("rejects extra fields, custom text, odd links and other versions", () => {
    expect(isGenericPayload(ok())).toBe(true);
    expect(isGenericPayload({ ...ok(), extra: "x" })).toBe(false);
    // A named line passes only when scrubbed: one line, no secret shapes.
    expect(isGenericPayload({ ...ok(), b: "Fix the login bug" })).toBe(true);
    expect(isGenericPayload({ ...ok(), b: "line one\nline two" })).toBe(false);
    expect(
      isGenericPayload({ ...ok(), b: "s" + "k-" + "abcdefgh12345678" })
    ).toBe(false);
    expect(isGenericPayload({ ...ok(), t: "x".repeat(200) })).toBe(false);
    expect(isGenericPayload({ ...ok(), l: "https://evil.example" })).toBe(
      false
    );
    expect(isGenericPayload({ ...ok(), l: "/task/a b" })).toBe(false);
    expect(isGenericPayload({ ...ok(), v: 2 })).toBe(false);
    expect(isGenericPayload({ ...ok(), c: "nope" })).toBe(false);
    expect(isGenericPayload(null)).toBe(false);
  });
});

describe("parsePushEnvelope", () => {
  it("round-trips v1", () => {
    const p = buildPushPayload({ category: "ci", id: "t2", key: "ci:t2:abc" });
    expect(parsePushEnvelope(p)).toEqual(p);
  });

  it("reads an unknown version or junk as the generic fallback", () => {
    for (const raw of [{ v: 9, x: 1 }, null, "str", 5, {}]) {
      const p = parsePushEnvelope(raw);
      expect(p.t).toBe("AgentOS");
      expect(p.l).toMatch(/^\//);
    }
  });

  it("opens only app links from a v2 body", () => {
    const p = parsePushEnvelope({
      v: 2,
      c: "review",
      l: "https://evil.example",
      b: "x",
    });
    expect(p.l).toBe("/needs");
    expect(parsePushEnvelope({ v: 2, c: "review", l: "/task/ab" }).l).toBe(
      "/task/ab"
    );
  });
});

describe("redact", () => {
  it("looksSecret spots token shapes", () => {
    for (const s of Object.values(fake)) expect(looksSecret(s())).toBe(true);
    expect(looksSecret("plain words here")).toBe(false);
  });

  it("scrubText keeps the first line, strips code and secrets, clips", () => {
    expect(scrubText("\n\nfirst `line`\nsecond")).toBe("first line");
    expect(scrubText(`use ${fake.ghp()} now`)).toBe("use … now");
    expect(scrubText(`key ${fake.hex()}`)).toBe("key …");
    expect(scrubText("a  b\t c")).toBe("a b c");
    expect(scrubText("x ".repeat(100), 20).length).toBeLessThanOrEqual(20);
    expect(scrubText(null)).toBe("");
  });

  it("safeId and safeKey accept plain values only", () => {
    expect(safeId("abc-DEF_1")).toBe("abc-DEF_1");
    expect(safeId("a b")).toBeNull();
    // App-made ids are long runs but not tokens.
    expect(safeId("user-1760000000000-ab12c")).toBe("user-1760000000000-ab12c");
    expect(safeId("aosd_abcdefghijklmnop")).toBeNull();
    expect(safeId(42)).toBeNull();
    expect(safeKey("review:t1:abc123")).toBe("review:t1:abc123");
    expect(safeKey("has space")).toBeNull();
    expect(safeKey("k".repeat(129))).toBeNull();
  });
});

describe("named text", () => {
  it("a sender's title and body replace the fixed ones, scrubbed", () => {
    const p = buildPushPayload({
      category: "plan",
      id: "abc",
      title: "Plan ready",
      body: "Recipes, 2 pieces\nsecond line",
    });
    expect(p).toMatchObject({
      c: "plan",
      t: "Plan ready",
      b: "Recipes, 2 pieces",
    });
    expect(isGenericPayload(p)).toBe(true);
  });
  it("secret-shaped text falls back to the fixed copy", () => {
    const p = buildPushPayload({
      category: "merged",
      body: "gh" + "p_" + "a".repeat(24),
    });
    expect(p.b).not.toContain("ghp_");
  });
});
