import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { NumberSetting, SwitchSetting } = await import("./settings-fields");

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

async function render(el: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(el));
}
const noop = () => Promise.resolve();

describe("Reset and default text", () => {
  const num = (value: number, extra = {}) =>
    createElement(NumberSetting, {
      id: "n",
      label: "Days",
      value,
      defaultValue: 7,
      min: 1,
      max: 30,
      unit: "days",
      onSave: noop,
      ...extra,
    });

  it("shows no default text or Reset while the value is the default", async () => {
    await render(num(7));
    expect(host.textContent).not.toMatch(/default|Reset/i);
  });

  it("offers 'Reset to X' once it differs", async () => {
    await render(num(9));
    expect(host.textContent).toContain("Reset to 7");
    expect(host.textContent).not.toContain("Default:");
  });

  it("puts the range in the help text and the unit right after the number", async () => {
    await render(num(7));
    expect(host.textContent).toContain("Allowed: 1–30 days.");
    const input = host.querySelector("input")!;
    expect(input.nextElementSibling?.textContent).toBe("days");
  });

  it("disables and empties the field while its switch is off", async () => {
    await render(num(0, { optional: { off: 0, on: 7 } }));
    const input = host.querySelector("input")!;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe("");
  });

  it("shows Reset to on/off for a switch only when it differs", async () => {
    await render(
      createElement(SwitchSetting, {
        id: "s",
        label: "Sound",
        checked: true,
        defaultValue: true,
        onSave: noop,
      })
    );
    expect(host.textContent).not.toMatch(/Reset/);
    await act(async () => root.unmount());
    host.remove();
    await render(
      createElement(SwitchSetting, {
        id: "s",
        label: "Sound",
        checked: false,
        defaultValue: true,
        onSave: noop,
      })
    );
    expect(host.textContent).toContain("Reset to on");
  });
});
