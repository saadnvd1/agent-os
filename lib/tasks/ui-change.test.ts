import { describe, expect, it } from "vitest";
import {
  hasUiEvidence,
  isUiPath,
  uiEvidenceNote,
  uiFilesIn,
  withUiEvidenceNote,
} from "./ui-change";

const file = (p: string, status = "M") => ({ path: p, status });

describe("isUiPath", () => {
  it("is true for what a user sees", () => {
    for (const p of [
      "components/Board.tsx",
      "app/views/cards/show.html.erb",
      "app/frontend/styles/a.css",
      "app/components/card_component.rb",
      "Sources/Views/Row.swift",
    ])
      expect(isUiPath(p), p).toBe(true);
  });

  it("is false for logic, docs and tests", () => {
    for (const p of [
      "lib/x.ts",
      "README.md",
      "components/Board.test.tsx",
      "spec/views/x_spec.rb",
      "components/Board.stories.tsx",
      "e2e/board.tsx",
    ])
      expect(isUiPath(p), p).toBe(false);
  });

  it("ignores deleted files", () => {
    expect(uiFilesIn([file("a.tsx", "D"), file("b.tsx")])).toEqual(["b.tsx"]);
  });
});

describe("hasUiEvidence", () => {
  it("accepts images and a described check", () => {
    expect(hasUiEvidence("![board](https://x/y.png)")).toBe(true);
    expect(hasUiEvidence("## Browser check\nBoard at 390x844")).toBe(true);
    expect(hasUiEvidence("Checked in the simulator.")).toBe(true);
  });

  it("rejects a body that says nothing of it", () => {
    expect(hasUiEvidence("Adds a column. Tests pass.")).toBe(false);
    expect(hasUiEvidence("<!-- screenshot here -->\nDone.")).toBe(false);
  });

  it("is undefined when the body wasn't read", () => {
    expect(hasUiEvidence(undefined)).toBeUndefined();
  });
});

describe("the reviewer's note", () => {
  const ui = [file("a.tsx"), file("b.css"), file("c.vue"), file("d.erb")];

  it("is made for UI files with no evidence, naming the first three", () => {
    const note = uiEvidenceNote(ui, false)!;
    expect(note).toMatch(/^\[minor\] a\.tsx, b\.css, c\.vue, \+1 more/);
    expect(note).toContain("Not a merge gate");
  });

  it("is not made without UI files, with evidence, or with an unread body", () => {
    expect(uiEvidenceNote([file("lib/x.ts")], false)).toBeNull();
    expect(uiEvidenceNote(ui, true)).toBeNull();
    expect(uiEvidenceNote(ui, undefined)).toBeNull();
  });

  it("never changes the verdict's status", () => {
    const note = uiEvidenceNote(ui, false);
    for (const status of ["pass", "block"] as const) {
      const out = withUiEvidenceNote({ status, detail: "ok" }, note);
      expect(out.status).toBe(status);
      expect(out.detail).toContain("ok\n- [minor]");
    }
    expect(withUiEvidenceNote({ status: "pass", detail: "ok" }, null)).toEqual({
      status: "pass",
      detail: "ok",
    });
  });
});
