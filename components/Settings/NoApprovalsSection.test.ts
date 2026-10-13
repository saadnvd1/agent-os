import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Radix dispatches its own events; they must be jsdom's, not Node's.
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
  on: false,
  audit: [] as object[],
  mutate: vi.fn(),
}));
vi.mock("@/data/approvals", () => ({
  useApprovalsModeQuery: () => ({
    isPending: false,
    isError: false,
    data: { on: state.on, audit: state.audit },
  }),
  useSetApprovalsMode: () => ({
    mutate: state.mutate,
    isPending: false,
    error: null,
  }),
}));

const { NoApprovalsSection } = await import("./NoApprovalsSection");
const { NoApprovalsBadge } =
  await import("@/components/Approvals/NoApprovalsBadge");

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  state.on = false;
  state.audit = [];
  state.mutate.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (el: ReturnType<typeof createElement>) =>
  act(() => root.render(el));
const click = (el: Element | null) =>
  act(() => {
    el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
const byText = (text: string) =>
  [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text)
  ) ?? null;

describe("the No approvals toggle", () => {
  it("is off, and flipping it warns first without switching anything", () => {
    render(createElement(NoApprovalsSection));
    const toggle = host.querySelector('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    click(toggle!);
    const warning = host.querySelector('[role="alertdialog"]');
    expect(warning?.textContent).toMatch(/hard lines included/);
    expect(warning?.textContent).toMatch(/permission prompts off/);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("switches on only when the warning is confirmed, and cancel backs out", () => {
    render(createElement(NoApprovalsSection));
    click(host.querySelector('[role="switch"]'));
    click(byText("Cancel"));
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
    click(host.querySelector('[role="switch"]'));
    click(byText("Turn on No approvals"));
    expect(state.mutate).toHaveBeenCalledWith(true, expect.any(Object));
  });

  it("switches off at once, and lists what was approved for you", () => {
    state.on = true;
    state.audit = [
      {
        id: 1,
        at: "2026-10-13 10:00:00",
        source: "ask",
        subject: 'money ask "Pay?"',
        detail: "",
      },
    ];
    render(createElement(NoApprovalsSection));
    expect(host.textContent).toContain('money ask "Pay?"');
    click(host.querySelector('[role="switch"]'));
    expect(state.mutate).toHaveBeenCalledWith(false);
  });
});

describe("the badge", () => {
  it("shows only while the mode is on", () => {
    render(createElement(NoApprovalsBadge));
    expect(host.textContent).toBe("");
    state.on = true;
    render(createElement(NoApprovalsBadge));
    expect(host.textContent).toContain("No approvals");
  });
});
