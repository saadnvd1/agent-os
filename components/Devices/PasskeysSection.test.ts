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

const state = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.stubGlobal("location", { hostname: "x" });
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/data/presence", () => ({
  NO_PASSKEYS_HERE: "no",
  passkeysHere: () => true,
}));
vi.mock("@/data/presence/passkeys", () => ({
  usePasskeysQuery: () => ({
    data: {
      bootstrapped: true,
      passkeys: [
        {
          id: "k1",
          name: "Laptop",
          rp_id: "x",
          type: "browser",
          created_at: "2026-10-01 10:00:00",
          registered_from: null,
          last_used_at: null,
        },
      ],
    },
  }),
  useAddPasskey: () => ({ mutate: vi.fn(), isPending: false }),
  useEnrollCode: () => ({ mutate: vi.fn(), isPending: false }),
  useRevokePasskey: () => ({ mutate: state.revoke, isPending: false }),
}));

const { PasskeysSection } = await import("./PasskeysSection");

let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  state.revoke.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(createElement(PasskeysSection, { open: true }))
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const click = (el: Element | null | undefined) =>
  act(async () => {
    el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
const button = (name: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === name);

describe("PasskeysSection revoke", () => {
  it("asks inline, not with a browser dialog, and revokes only on confirm", async () => {
    const dialog = vi.spyOn(window, "confirm");
    await click(host.querySelector('[aria-label="Revoke Laptop"]'));
    expect(host.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(state.revoke).not.toHaveBeenCalled();
    await click(button("Revoke"));
    expect(state.revoke).toHaveBeenCalledWith("k1", expect.any(Object));
    expect(dialog).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("Cancel leaves the passkey alone", async () => {
    await click(host.querySelector('[aria-label="Revoke Laptop"]'));
    await click(button("Cancel"));
    expect(state.revoke).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
  });
});
