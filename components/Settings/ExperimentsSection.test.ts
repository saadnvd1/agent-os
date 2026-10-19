import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

for (const key of [
  "Event",
  "CustomEvent",
  "FocusEvent",
  "HTMLButtonElement",
  "HTMLFormElement",
])
  Object.defineProperty(globalThis, key, {
    value: (window as unknown as Record<string, unknown>)[key],
    configurable: true,
    writable: true,
  });
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const w = (calls: number) => ({
  calls,
  tokens: calls * 1000,
  costUsd: calls * 0.01,
  scripts: 0,
  shown: 0,
  accepted: 1,
  dismissed: 1,
  acceptRate: 0.5,
});
const state = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/data/experiments", () => ({
  useExperimentsQuery: () => ({
    isPending: false,
    isError: false,
    data: {
      locked: false,
      experiments: [
        {
          id: "learning-cards",
          name: "Learning cards",
          description: "Suggest things when a session ends.",
          area: "sessions",
          status: "experimental",
          suggests: true,
          on: false,
          usage: { today: w(1), d7: w(2), d30: w(3) },
        },
      ],
    },
  }),
  useSetExperiment: () => ({ mutate: state.mutate }),
  useExperimentDetailQuery: () => ({ isPending: true }),
}));

const { ExperimentsSection } = await import("./ExperimentsSection");

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  state.mutate.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ExperimentsSection", () => {
  it("lists each experiment, off, with its usage", () => {
    act(() => root.render(createElement(ExperimentsSection)));
    expect(host.textContent).toContain("Learning cards");
    expect(host.textContent).toContain("Suggest things when a session ends.");
    expect(host.textContent).toContain("50% (1/2)");
    expect(
      host.querySelector('[role="switch"]')?.getAttribute("aria-checked")
    ).toBe("false");
  });

  it("turns one on from its toggle", () => {
    act(() => root.render(createElement(ExperimentsSection)));
    act(() => {
      host
        .querySelector('[role="switch"]')
        ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(state.mutate).toHaveBeenCalledWith(
      { id: "learning-cards", on: true },
      expect.any(Object)
    );
  });
});
