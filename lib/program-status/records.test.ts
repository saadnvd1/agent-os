import { describe, expect, it } from "vitest";
import type { Report } from "./parse";
import {
  MAX_RECORDS,
  applyReport,
  dropTransient,
  summarize,
  type Records,
} from "./records";

const r = (state: Report["state"], extra: Partial<Report> = {}): Report => ({
  state,
  id: "",
  ...extra,
});

function apply(reports: Report[], fg?: string): Records {
  return reports.reduce<Records>(
    (records, report, i) => applyReport(records, report, i + 1, fg),
    {}
  );
}

describe("applyReport", () => {
  it("replaces a record whole: keys left out are gone", () => {
    const records = apply([
      r("blocked", { kind: "permission", msg: "Allow?", app: "x" }),
      r("working"),
    ]);
    expect(records[""]).toEqual({ id: "", state: "working", at: 2 });
  });

  it("clear with no id removes everything; with an id, that subtree", () => {
    const records = apply([
      r("idle"),
      r("working", { id: "a" }),
      r("blocked", { id: "a/b" }),
      r("done", { id: "ab" }),
    ]);
    expect(
      Object.keys(applyReport(records, r("clear", { id: "a" }), 9))
    ).toEqual(["", "ab"]);
    expect(applyReport(records, r("clear"), 9)).toEqual({});
  });

  it("evicts the least recently updated record past the cap", () => {
    const reports = Array.from({ length: MAX_RECORDS + 1 }, (_, i) =>
      r("working", { id: `w${i}` })
    );
    const records = apply(reports);
    expect(Object.keys(records)).toHaveLength(MAX_RECORDS);
    expect(records.w0).toBeUndefined();
    expect(records[`w${MAX_RECORDS}`]).toBeDefined();
  });

  it("remembers the foreground program only for working and blocked", () => {
    expect(apply([r("working")], "claude")[""].fg).toBe("claude");
    expect(apply([r("done")], "claude")[""].fg).toBeUndefined();
  });
});

describe("dropTransient", () => {
  const records = apply(
    [r("working", { id: "w" }), r("done", { id: "d" })],
    "claude"
  );

  it("drops working and blocked at a new shell prompt, keeps done", () => {
    expect(Object.keys(dropTransient(records))).toEqual(["d"]);
  });

  it("drops them when a different program is in front", () => {
    expect(Object.keys(dropTransient(records, "zsh"))).toEqual(["d"]);
    expect(Object.keys(dropTransient(records, "claude"))).toEqual(["w", "d"]);
  });

  it("keeps a report newer than the look at the foreground", () => {
    expect(Object.keys(dropTransient(records, "zsh", 1))).toEqual(["w", "d"]);
  });
});

describe("summarize", () => {
  it("has nothing to say without records", () => {
    expect(summarize({})).toBeNull();
  });

  it("puts blocked first, then error, working, done, idle", () => {
    const records = apply([
      r("idle", { app: "deploy" }),
      r("working", { id: "eu", progress: 40 }),
      r("blocked", { id: "us", kind: "auth", msg: "Sign in to AWS" }),
      r("done", { id: "ap" }),
    ]);
    expect(summarize(records)).toEqual({
      state: "blocked",
      kind: "auth",
      app: "deploy",
      msg: "Sign in to AWS",
      progress: undefined,
      at: 3,
    });
    const { us: _us, ...rest } = records;
    expect(summarize(rest)?.state).toBe("working");
    expect(summarize(rest)?.progress).toBe(40);
  });

  it("takes the newest record of the same state", () => {
    const records = apply([
      r("done", { id: "a", msg: "first" }),
      r("done", { id: "b", msg: "second" }),
    ]);
    expect(summarize(records)?.msg).toBe("second");
  });
});
