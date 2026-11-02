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
  accepted: calls ? 1 : 0,
  dismissed: calls ? 1 : 0,
  acceptRate: calls ? 0.5 : null,
});
const state = vi.hoisted(() => ({
  zero: false,
  mutateAsync: vi.fn().mockResolvedValue({}),
}));
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
          usage: state.zero
            ? { today: w(0), d7: w(0), d30: w(0) }
            : { today: w(1), d7: w(2), d30: w(3) },
        },
      ],
    },
  }),
  useSetExperiment: () => ({ mutateAsync: state.mutateAsync }),
  useExperimentDetailQuery: () => ({ isPending: true }),
}));

const { ExperimentsSection } = await import("./ExperimentsSection");

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  state.mutateAsync.mockClear();
  state.zero = false;
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

  it("doesn't tag every card Experimental", () => {
    act(() => root.render(createElement(ExperimentsSection)));
    expect(host.textContent).not.toContain("Experimental");
  });

  it("shows an empty state instead of a table of zeros", () => {
    state.zero = true;
    act(() => root.render(createElement(ExperimentsSection)));
    expect(host.querySelector("table")).toBeNull();
    expect(host.textContent).toContain("No usage yet");
  });

  it("turns one on from its toggle", () => {
    act(() => root.render(createElement(ExperimentsSection)));
    act(() => {
      host
        .querySelector('[role="switch"]')
        ?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(state.mutateAsync).toHaveBeenCalledWith({
      id: "learning-cards",
      on: true,
    });
  });
});
