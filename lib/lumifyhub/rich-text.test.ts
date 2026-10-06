import { describe, it, expect } from "vitest";
import { richTextToPlain } from "./rich-text";
import { promptFromCard } from "./task-cards";
import type { LhCard } from "./types";

describe("card descriptions", () => {
  it("flattens a document into lines", () => {
    expect(
      richTextToPlain({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Fix login" }] },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "a" }] },
                ],
              },
            ],
          },
        ],
      })
    ).toBe("Fix login\n- a");
    expect(richTextToPlain("  plain ")).toBe("plain");
    expect(richTextToPlain(null)).toBe("");
  });

  it("makes the task prompt title + description", () => {
    const card = { title: "T", description: "D" } as LhCard;
    expect(promptFromCard(card)).toBe("T\n\nD");
    expect(promptFromCard({ ...card, description: null })).toBe("T");
  });
});
