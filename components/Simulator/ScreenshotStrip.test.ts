import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SimulatorStatus } from "@/data/simulator";

for (const key of [
  "Event",
  "CustomEvent",
  "FocusEvent",
  "PopStateEvent",
  "NodeFilter",
  "HTMLButtonElement",
])
  Object.defineProperty(globalThis, key, {
    value: (window as unknown as Record<string, unknown>)[key],
    configurable: true,
    writable: true,
  });

let status: Partial<SimulatorStatus> | undefined;
vi.mock("@/data/simulator", () => ({
  useSimulatorStatus: () => ({ data: status }),
}));

import { ScreenshotStrip, SimulatorIndicator } from "./ScreenshotStrip";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
async function mount(el: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(el));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  document.body.innerHTML = "";
});

const indicator = () => createElement(SimulatorIndicator, { sessionId: "s1" });
const button = () => document.querySelector("button[aria-label^='Simulator']");

describe("SimulatorIndicator", () => {
  it("renders nothing without a lease, while starting, or once shut down", async () => {
    for (const state of [undefined, "none", "starting", "shutdown", "failed"]) {
      status = state ? ({ state, shots: [] } as never) : undefined;
      await mount(indicator());
      expect(button()).toBeNull();
      await act(async () => root!.unmount());
      host!.remove();
    }
  });

  it("shows the phone with no count when booted and no shots yet", async () => {
    status = { state: "ready", shots: [] };
    await mount(indicator());
    expect(button()?.getAttribute("aria-label")).toBe(
      "Simulator booted, 0 screenshots"
    );
    expect(button()?.textContent).toBe("");
  });

  it("shows the screenshot count and opens the strip, then a shot full size", async () => {
    status = { state: "ready", shots: ["/t/a b.png", "/t/c.png"] };
    await mount(indicator());
    expect(button()?.textContent).toBe("2");
    await act(async () => (button() as HTMLElement).click());
    const thumbs = document.querySelectorAll("img");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0].getAttribute("src")).toBe(
      "/api/files/image?path=%2Ft%2Fa%20b.png"
    );
    await act(async () => (thumbs[1].closest("button") as HTMLElement).click());
    const full = document.querySelectorAll("img");
    expect(full).toHaveLength(1);
    expect(full[0].getAttribute("src")).toContain("c.png");
  });
});

describe("ScreenshotStrip", () => {
  it("says so when there are none", async () => {
    await mount(createElement(ScreenshotStrip, { shots: [] }));
    expect(document.body.textContent).toContain("No screenshots yet");
  });
});
