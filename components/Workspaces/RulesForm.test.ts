import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  update: vi.fn(),
  add: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: state.toast } }));
vi.mock("@/data/orchestrators/rules", () => ({
  useRulesQuery: () => ({
    isPending: false,
    isError: false,
    data: [
      { id: 4, workspace_id: "w1", text: "Never merge #12", added_by: "saad" },
    ],
  }),
  useAddRule: () => ({ mutateAsync: state.add }),
  useUpdateRule: () => ({ mutateAsync: state.update }),
  useRemoveRule: () => ({ mutate: vi.fn(), isPending: false }),
}));

const { RulesForm } = await import("./RulesForm");

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  state.update.mockReset().mockResolvedValue(undefined);
  state.add.mockReset().mockResolvedValue(undefined);
  state.toast.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const type = async (input: HTMLInputElement, text: string) => {
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!;
  await act(async () => {
    set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const rule = () => host.querySelector<HTMLInputElement>("#rule-4")!;
const click = (el: Element | null | undefined) =>
  act(async () => {
    el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name);

describe("RulesForm", () => {
  beforeEach(async () => {
    await act(async () =>
      root.render(createElement(RulesForm, { workspaceId: "w1" }))
    );
  });

  it("never asks for a passkey on blur", async () => {
    await type(rule(), "Never merge #13");
    await act(async () => {
      rule().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("saves through the passkey step on the Save button, and says Saved", async () => {
    await type(rule(), "Never merge #13");
    await click(button("Save"));
    expect(state.update).toHaveBeenCalledWith({
      id: 4,
      text: "Never merge #13",
    });
    expect(host.textContent).toContain("Saved");
  });

  it("saves on Enter", async () => {
    await type(rule(), "Never merge #13");
    await act(async () => {
      rule().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });
    expect(state.update).toHaveBeenCalledOnce();
  });

  it("rolls back and toasts when the passkey is cancelled", async () => {
    state.update.mockRejectedValue(new Error("Passkey cancelled"));
    await type(rule(), "Never merge #13");
    await click(button("Save"));
    expect(rule().value).toBe("Never merge #12");
    expect(state.toast).toHaveBeenCalledWith("Passkey cancelled");
    expect(host.textContent).not.toContain("Saved");
  });

  it("won't save an empty rule", async () => {
    await type(rule(), "  ");
    await click(button("Save"));
    expect(state.update).not.toHaveBeenCalled();
    expect(host.textContent).toContain("A rule can't be empty");
  });

  it("adds a rule through the same step", async () => {
    const input = host.querySelector<HTMLInputElement>("#rule-new-w1")!;
    await type(input, "House rule");
    await click(button("Add"));
    expect(state.add).toHaveBeenCalledWith("House rule");
  });
});
