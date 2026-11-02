import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { NumberSetting } = await import("./settings-fields");

let root: Root;
let host: HTMLElement;
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function mount(save: (n: number) => Promise<unknown>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(NumberSetting, {
        id: "n",
        label: "Days",
        value: 7,
        defaultValue: 7,
        min: 1,
        max: 30,
        onSave: save,
      })
    )
  );
  return host.querySelector("input")!;
}

// React tracks the value; set it the way the browser does, then blur.
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
const blur = (input: HTMLInputElement) =>
  act(async () => {
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });

describe("NumberSetting", () => {
  it("keeps an invalid value in the field with a message and sends nothing", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const input = await mount(save);
    await type(input, "40");
    await blur(input);
    expect(save).not.toHaveBeenCalled();
    expect(input.value).toBe("40");
    expect(host.textContent).toContain("Enter a whole number from 1 to 30.");
  });

  it("saves a valid value on blur", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const input = await mount(save);
    await type(input, "14");
    await blur(input);
    expect(save).toHaveBeenCalledWith(14);
  });

  it("reverts on Escape without saving", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const input = await mount(save);
    await type(input, "40");
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
      );
    });
    expect(input.value).toBe("7");
    expect(save).not.toHaveBeenCalled();
  });

  it("goes back to the saved value when the server rejects", async () => {
    const save = vi.fn().mockRejectedValue(new Error("no"));
    const input = await mount(save);
    await type(input, "14");
    await blur(input);
    expect(save).toHaveBeenCalledWith(14);
    expect(input.value).toBe("7");
  });
});
