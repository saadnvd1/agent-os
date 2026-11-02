import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Radix dispatches its own events; they must be jsdom's, not Node's.
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

const state = vi.hoisted(() => ({
  on: false,
  audit: [] as object[],
  mutate: vi.fn(),
}));
vi.mock("@/components/Merge/MergeApprovalToggle", () => ({
  MergeApprovalToggle: ({ overriddenBy }: { overriddenBy?: boolean }) =>
    createElement(
      "p",
      { "data-merge": String(!!overriddenBy) },
      "merge toggle"
    ),
}));
vi.mock("@/data/approvals", () => ({
  useApprovalsModeQuery: () => ({
    isPending: false,
    isError: false,
    data: { on: state.on, audit: state.audit },
  }),
  useSetApprovalsMode: () => ({
    mutateAsync: state.mutate,
    isPending: false,
    error: null,
  }),
}));

const { TooltipProvider } = await import("@/components/ui/tooltip");
const { ApprovalsSection } = await import("./ApprovalsSection");
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
  act(async () => {
    el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
const byText = (text: string) =>
  [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text)
  ) ?? null;

describe("the Approvals section", () => {
  beforeEach(() => {
    state.mutate.mockResolvedValue(undefined);
  });

  it("is off, and flipping it warns first without switching anything", async () => {
    render(createElement(ApprovalsSection));
    const toggle = host.querySelector('[role="switch"]');
    expect(toggle?.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    await click(toggle!);
    const warning = host.querySelector('[role="alertdialog"]');
    expect(warning?.textContent).toMatch(/hard lines included/);
    expect(warning?.textContent).toMatch(/permission prompts off/);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it("switches on only when the warning is confirmed, and cancel backs out", async () => {
    render(createElement(ApprovalsSection));
    await click(host.querySelector('[role="switch"]'));
    await click(byText("Cancel"));
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(state.mutate).not.toHaveBeenCalled();
    await click(host.querySelector('[role="switch"]'));
    await click(byText("Turn on No approvals"));
    expect(state.mutate).toHaveBeenCalledWith(true);
  });

  it("switches off at once", async () => {
    state.on = true;
    render(createElement(ApprovalsSection));
    await click(host.querySelector('[role="switch"]'));
    expect(state.mutate).toHaveBeenCalledWith(false);
  });

  it("holds the merge approval switch in the same place, greyed while the mode is on", () => {
    render(createElement(ApprovalsSection));
    expect(host.querySelector("[data-merge]")?.getAttribute("data-merge")).toBe(
      "false"
    );
    state.on = true;
    act(() => root.unmount());
    root = createRoot(host);
    render(createElement(ApprovalsSection));
    expect(host.querySelector("[data-merge]")?.getAttribute("data-merge")).toBe(
      "true"
    );
  });

  it("lists what was approved in words, with a command behind Details", async () => {
    state.on = true;
    state.audit = [
      {
        id: 1,
        at: "2026-10-13 10:00:00",
        where: "A chat",
        summary: "Ran a command",
        details: "ssh root@host 'ls /tmp'",
      },
    ];
    render(createElement(ApprovalsSection));
    expect(host.textContent).toContain("Ran a command");
    expect(host.textContent).not.toContain("ssh root@host");
    await click(byText("Details"));
    expect(host.textContent).toContain("ssh root@host 'ls /tmp'");
  });

  it("says so when nothing was approved", () => {
    render(createElement(ApprovalsSection));
    expect(host.textContent).toContain("Nothing yet.");
  });
});

describe("the badge", () => {
  it("shows only while the mode is on", () => {
    const badge = () =>
      createElement(TooltipProvider, null, createElement(NoApprovalsBadge));
    render(badge());
    expect(host.textContent).toBe("");
    state.on = true;
    render(badge());
    expect(host.textContent).toContain("No approvals");
  });
});
