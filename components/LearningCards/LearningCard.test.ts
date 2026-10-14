import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "@/lib/learning-cards/types";

for (const key of ["Event", "CustomEvent", "FocusEvent", "HTMLButtonElement"])
  Object.defineProperty(globalThis, key, {
    value: (window as unknown as Record<string, unknown>)[key],
    configurable: true,
    writable: true,
  });
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  cards: undefined as unknown,
  apply: vi.fn(),
  dismiss: vi.fn(),
  saveSessionAs: vi.fn(),
}));
vi.mock("@/data/learning-cards", () => ({
  useLearningCards: () => ({ data: state.cards }),
  useApplyCard: () => ({
    apply: state.apply,
    dismiss: state.dismiss,
    isPending: false,
  }),
}));
vi.mock("@/stores/recipesUi", () => ({
  recipesUiActions: { saveSessionAs: state.saveSessionAs },
}));

const { LearningCards, LearningCardsHost, destinationLabel } =
  await import("./LearningCard");

const base = {
  session_id: "s1",
  workspace_id: "w1",
  status: "pending",
  applied_ref: null,
  shown_at: null,
  decided_at: null,
  created_at: 1,
} as const;
const cards = [
  {
    ...base,
    id: 1,
    kind: "recipe",
    destination: null,
    payload: { signals: [], brief: "Send the build", summary: "" },
  },
  {
    ...base,
    id: 2,
    kind: "lesson",
    destination: "claude_md",
    payload: {
      lesson: "Run the linter first",
      destination: "claude_md",
      projectName: "Web",
      pairs: 1,
    },
  },
] as unknown as Card[];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  for (const f of [state.apply, state.dismiss, state.saveSessionAs])
    f.mockReset();
  state.cards = cards;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const click = (label: string, nth = 0) =>
  act(() => {
    [...host.querySelectorAll("button")]
      .filter((b) => b.textContent === label)
      [nth].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });

describe("LearningCardsHost", () => {
  it("shows both rows, with the destination in plain words", () => {
    act(() =>
      root.render(createElement(LearningCardsHost, { sessionId: "s1" }))
    );
    expect(host.textContent).toContain("Save as recipe?");
    expect(host.textContent).toContain("Keep this for next time?");
    expect(host.textContent).toContain("CLAUDE.md in Web, through a PR");
    expect(host.querySelector("input")?.value).toBe("Run the linter first");
  });

  it("saves the recipe, applies the lesson with its edit, and dismisses", () => {
    act(() =>
      root.render(createElement(LearningCardsHost, { sessionId: "s1" }))
    );
    click("Save");
    expect(state.apply).toHaveBeenCalledWith(1, { brief: "Send the build" });
    click("Apply");
    expect(state.apply).toHaveBeenCalledWith(2, {
      lesson: "Run the linter first",
      taskPrompt: "",
    });
    click("Dismiss", 1);
    expect(state.dismiss).toHaveBeenCalledWith(2);
  });

  it("Edit opens the recipe form for the session", () => {
    act(() =>
      root.render(createElement(LearningCardsHost, { sessionId: "s1" }))
    );
    click("Edit");
    expect(state.saveSessionAs).toHaveBeenCalledWith("s1");
  });

  it("renders nothing when off (no data) or when there are no cards", () => {
    state.cards = undefined;
    act(() =>
      root.render(createElement(LearningCardsHost, { sessionId: "s1" }))
    );
    expect(host.innerHTML).toBe("");
    act(() =>
      root.render(
        createElement(LearningCards, {
          cards: [],
          onApply: vi.fn(),
          onDismiss: vi.fn(),
          onEditRecipe: vi.fn(),
        })
      )
    );
    expect(host.innerHTML).toBe("");
  });
});

describe("destinationLabel", () => {
  it("names each place", () => {
    const p = { lesson: "x", pairs: 1 } as const;
    expect(
      destinationLabel({ ...p, destination: "recipe", recipeName: "Build" })
    ).toBe("Recipe brief: Build");
    expect(destinationLabel({ ...p, destination: "rule" })).toBe(
      "Workspace rule"
    );
    expect(destinationLabel({ ...p, destination: "check" })).toContain("task");
  });
});
