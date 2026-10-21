import { describe, expect, it } from "vitest";
import { buildDoc } from "./build";
import { sizeOf, turnInfos, warningsFor } from "./estimate";
import { renderMarkdown } from "./markdown";
import { selectTurns } from "./summary";
import { ctx, twoTurns } from "./fixtures";

const meta = { name: "My chat", agent: "claude", createdAt: 0 };
const sel = (mode: "full" | "compact", redact: "all" | "secrets" = "all") =>
  selectTurns(buildDoc({ items: twoTurns(), meta, mode, redact, ctx }));
const codes = (w: { code: string }[]) => w.map((x) => x.code);

describe("estimate", () => {
  it("counts the bytes of the file, and about a quarter as many tokens", () => {
    const file = "héllo wörld";
    expect(sizeOf(file).bytes).toBe(Buffer.byteLength(file));
    expect(sizeOf("x".repeat(400)).tokens).toBe(100);
  });

  it("lists the turns with their time and first words", () => {
    const turns = turnInfos(sel("compact").doc);
    expect(turns.map((t) => t.n)).toEqual([1, 2]);
    expect(turns[1].excerpt).toBe("thanks");
    expect(turns[0].tokens).toBeGreaterThan(turns[1].tokens);
  });

  it("warns by size at the thresholds", () => {
    const s = sel("compact");
    const w = (tokens: number, bytes = 1) =>
      codes(
        warningsFor(s, { tokens, bytes }, { mode: "compact", redact: "all" })
      );
    expect(w(1000)).not.toContain("large");
    expect(w(100_001)).toContain("large");
    expect(w(1_000_001)).toContain("huge");
    expect(w(1000, 26 * 1024 * 1024)).toContain("too-big");
  });

  it("always has the sensitive-data line, and escalates", () => {
    const small = { tokens: 1, bytes: 1 };
    expect(
      codes(
        warningsFor(sel("compact"), small, { mode: "compact", redact: "all" })
      )
    ).toEqual(["secrets-found", "sensitive"]);
    const full = codes(
      warningsFor(sel("full", "secrets"), small, {
        mode: "full",
        redact: "secrets",
      })
    );
    expect(full).toEqual(
      expect.arrayContaining([
        "paths-included",
        "full-output",
        "secrets-found",
        "sensitive",
      ])
    );
  });

  it("matches the file length it is given", () => {
    const body = renderMarkdown(sel("compact"), {
      mode: "compact",
      redact: "all",
      generatedAt: "2026-10-21",
    });
    expect(sizeOf(body).bytes).toBe(Buffer.byteLength(body));
  });
});
