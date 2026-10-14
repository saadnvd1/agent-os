import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateView } from "@/lib/updates/banner";

// Radix dispatches its own events; they must be jsdom's, not Node's.
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

let view: UpdateView | undefined;
const runMutate = vi.fn();
const cancelMutate = vi.fn();
vi.mock("@/data/updates", () => ({
  useUpdates: () => ({ data: view }),
  useRunUpdate: () => ({ mutate: runMutate, isPending: false }),
  useCancelUpdate: () => ({ mutate: cancelMutate, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const { UpdateBanner } = await import("./UpdateBanner");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const make = (over: Partial<UpdateView> = {}): UpdateView => ({
  current: { version: "0.3.1", sha: "a" },
  latest: {
    version: "0.3.5",
    sha: "b",
    notes: ["Faster boot (#9)"],
    url: "https://example.com/compare",
  },
  available: true,
  behind: 4,
  status: "ok",
  checkedAt: 1,
  checkError: null,
  bannerEnabled: true,
  bannerLocked: false,
  canUpdate: { ok: true },
  run: null,
  pending: null,
  working: { sessions: 0, reviews: 0, setups: 0 },
  ...over,
});

let root: Root;
let host: HTMLElement;
const render = () => act(async () => root.render(createElement(UpdateBanner)));
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute("aria-label") === label
  );

beforeEach(() => {
  localStorage.clear();
  runMutate.mockReset();
  cancelMutate.mockReset();
  view = make();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("UpdateBanner", () => {
  it("says which version is available, with a link to the notes", async () => {
    await render();
    expect(text()).toContain("AgentOS 0.3.5 is available");
    expect(
      document.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")
    ).toBe("https://example.com/compare");
    await act(async () => button("What's new")!.click());
    expect(text()).toContain("Faster boot (#9)");
  });

  it("Dismiss hides it for that version and survives a reload", async () => {
    await render();
    await act(async () => button("Dismiss until the next version")!.click());
    expect(text()).not.toContain("is available");
    expect(localStorage.getItem("agentos.update.dismissed")).toBe("0.3.5");

    // A new page load reads the same dismissal.
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    expect(text()).not.toContain("is available");
  });

  it("shows again for a newer version", async () => {
    localStorage.setItem("agentos.update.dismissed", "0.3.5");
    view = make({
      latest: { version: "0.3.6", sha: "c", notes: [], url: null },
    });
    await render();
    expect(text()).toContain("AgentOS 0.3.6 is available");
  });

  it("is absent when the banner is switched off or nothing is newer", async () => {
    view = make({ bannerEnabled: false });
    await render();
    expect(text()).toBe("");
    view = make({ available: false });
    await render();
    expect(text()).toBe("");
  });

  it("offers no Update button to a caller who can't update, and says why", async () => {
    view = make({
      canUpdate: {
        ok: false,
        code: "forbidden",
        reason: "Ask a device that can approve.",
      },
    });
    await render();
    expect(button("Update now")).toBeUndefined();
    expect(text()).toContain("Ask a device that can approve.");
  });

  it("Update now starts at once when nothing is working", async () => {
    await render();
    await act(async () => button("Update now")!.click());
    expect(runMutate).toHaveBeenCalledWith("now", expect.anything());
  });

  it("warns when work is running, and can wait for idle", async () => {
    view = make({ working: { sessions: 3, reviews: 0, setups: 0 } });
    await render();
    await act(async () => button("Update now")!.click());
    expect(runMutate).not.toHaveBeenCalled();
    expect(text()).toContain("3 sessions working");
    await act(async () => button("Update when idle")!.click());
    expect(runMutate).toHaveBeenCalledWith("idle", expect.anything());
  });

  it("shows a pending update with Cancel", async () => {
    view = make({ pending: { requestedAt: 1 } });
    await render();
    expect(text()).toContain("will update when nothing is working");
    await act(async () => button("Cancel")!.click());
    expect(cancelMutate).toHaveBeenCalled();
  });

  it("shows progress while updating, with no way to dismiss it", async () => {
    view = make({
      run: {
        id: "r",
        phase: "building",
        from: "a",
        fromVersion: "0.3.1",
        toVersion: "0.3.5",
        startedAt: Date.now(),
      },
    });
    await render();
    expect(text()).toContain("Building… step 3 of 4");
    expect(button("Dismiss")).toBeUndefined();
  });

  it("shows a failure with its error until dismissed", async () => {
    view = make({
      available: false,
      run: {
        id: "r9",
        phase: "failed",
        from: "a",
        fromVersion: "0.3.1",
        toVersion: "0.3.5",
        startedAt: 1,
        error: "build exploded",
      },
    });
    await render();
    expect(text()).toContain("build exploded");
    await act(async () => button("Dismiss")!.click());
    expect(text()).toBe("");
    expect(localStorage.getItem("agentos.update.dismissedRun")).toBe("r9");
  });
});
