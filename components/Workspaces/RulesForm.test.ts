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

const type = async (input: HTMLTextAreaElement, text: string) => {
  const set = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  )!.set!;
  await act(async () => {
    set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const editor = (id: string) => host.querySelector<HTMLTextAreaElement>(id)!;
const click = (el: Element | null | undefined) =>
  act(async () => {
    el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name);
const edit = () => click(host.querySelector('button[aria-label^="Edit rule"]'));

describe("RulesForm", () => {
  beforeEach(async () => {
    await act(async () =>
      root.render(createElement(RulesForm, { workspaceId: "w1" }))
    );
  });

  it("lists the rule as text with a You badge, and no editor or Save", () => {
    expect(host.textContent).toContain("Never merge #12");
    expect(host.textContent).toContain("You");
    expect(host.querySelector("textarea")).toBeNull();
    expect(button("Save")).toBeUndefined();
  });

  it("opens a multi-line editor on a click of the rule or its edit icon", async () => {
    await edit();
    expect(editor("#rule-4").value).toBe("Never merge #12");
    await click(button("Cancel"));
    await click(host.querySelector("li, [data-setting='rule-4'] button"));
    expect(editor("#rule-4")).not.toBeNull();
  });

  it("only enables Save once the text has changed", async () => {
    await edit();
    expect(button("Save")!.disabled).toBe(true);
    await type(editor("#rule-4"), "Never merge #13");
    expect(button("Save")!.disabled).toBe(false);
    await type(editor("#rule-4"), "Never merge #12");
    expect(button("Save")!.disabled).toBe(true);
    await type(editor("#rule-4"), "   ");
    expect(button("Save")!.disabled).toBe(true);
  });

  it("never asks for a passkey on blur", async () => {
    await edit();
    await type(editor("#rule-4"), "Never merge #13");
    await act(async () => {
      editor("#rule-4").dispatchEvent(
        new FocusEvent("focusout", { bubbles: true })
      );
    });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("saves through the passkey step on Save and closes the editor", async () => {
    await edit();
    await type(editor("#rule-4"), "Never merge #13");
    await click(button("Save"));
    expect(state.update).toHaveBeenCalledWith({
      id: 4,
      text: "Never merge #13",
    });
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("cancel closes the editor and drops what was typed", async () => {
    await edit();
    await type(editor("#rule-4"), "Never merge #13");
    await click(button("Cancel"));
    expect(state.update).not.toHaveBeenCalled();
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.textContent).toContain("Never merge #12");
    await edit();
    expect(editor("#rule-4").value).toBe("Never merge #12");
  });

  it("keeps the editor open and toasts when the passkey is cancelled", async () => {
    state.update.mockRejectedValue(new Error("Passkey cancelled"));
    await edit();
    await type(editor("#rule-4"), "Never merge #13");
    await click(button("Save"));
    expect(editor("#rule-4").value).toBe("Never merge #13");
    expect(state.toast).toHaveBeenCalledWith("Passkey cancelled");
  });

  it("adds a rule from the same editor, through the same step", async () => {
    await click(button("Add rule"));
    expect(button("Add rule")!.disabled).toBe(true);
    await type(editor("#rule-new-w1"), "House rule");
    await click(button("Add rule"));
    expect(state.add).toHaveBeenCalledWith("House rule");
    expect(host.querySelector("textarea")).toBeNull();
  });
});
