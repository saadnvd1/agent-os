import "@/components/Chat/composer/test-dom";
import { act, createElement, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

let desktopMatches = true;
window.matchMedia = ((query: string) => ({
  matches: desktopMatches,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;

let view: UpdateView | undefined;
const runMutate = vi.fn();
const cancelMutate = vi.fn();
vi.mock("@/data/updates", () => ({
  useUpdates: () => ({ data: view }),
  useRunUpdate: () => ({ mutate: runMutate, isPending: false }),
  useCancelUpdate: () => ({ mutate: cancelMutate, isPending: false }),
}));
// A stand-in for sonner: it records what the toast was asked to show, and a
// tray component renders the latest content like the real Toaster would.
interface Shown {
  render: (id: string) => React.ReactNode;
  opts: Record<string, unknown>;
}
const shown = new Map<string, Shown>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const custom = vi.fn((render: Shown["render"], opts: Shown["opts"]) => {
  shown.set(opts.id as string, { render, opts });
  emit();
});
const dismiss = vi.fn((id: string) => {
  shown.delete(id);
  emit();
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), custom, dismiss } }));

const { UpdateToast } = await import("./UpdateToast");
const { settingsUi } = await import("@/stores/settingsUi");

function Tray() {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    l();
    return () => void listeners.delete(l);
  }, []);
  return createElement(
    "div",
    null,
    [...shown].map(([id, t]) => createElement("div", { key: id }, t.render(id)))
  );
}

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
  canRestart: true,
  canUpdate: { ok: true },
  run: null,
  pending: null,
  working: { sessions: 0, reviews: 0, setups: 0 },
  ...over,
});

let root: Root;
let host: HTMLElement;
const qc = new QueryClient();
const render = () =>
  act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(UpdateToast),
        createElement(Tray)
      )
    )
  );
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) =>
      b.textContent?.trim() === label || b.getAttribute("aria-label") === label
  );

beforeEach(() => {
  localStorage.clear();
  shown.clear();
  custom.mockClear();
  dismiss.mockClear();
  settingsUi.open = false;
  settingsUi.section = null;
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

describe("UpdateToast", () => {
  it("says which version is available, with a link to the notes", async () => {
    await render();
    expect(text()).toContain("AgentOS 0.3.5 is available");
    expect(
      document.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")
    ).toBe("https://example.com/compare");
    await act(async () => button("Commit list")!.click());
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
    expect(shown.size).toBe(0);
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

  it("shows progress while updating and stays up, with a close button", async () => {
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
    expect(text()).toContain("Building… step 3 of 5");
    expect(custom.mock.calls.at(-1)![1].duration).toBe(Infinity);
  });

  it("shows a failure with its error and a link to the log, until dismissed", async () => {
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
    expect(custom.mock.calls.at(-1)![1].duration).toBe(Infinity);
    expect(document.querySelector("pre")).toBeNull();
    await act(async () => button("View log")!.click());
    expect(settingsUi.open).toBe(true);
    expect(settingsUi.section).toBe("updates");
    await act(async () => button("Dismiss")!.click());
    expect(text()).toBe("");
    expect(localStorage.getItem("agentos.update.dismissedRun")).toBe("r9");
  });

  it("says an automatic update happened, with What's New", async () => {
    view = make({
      available: false,
      run: {
        id: "a1",
        phase: "done",
        auto: true,
        from: "a",
        fromVersion: "0.3.1",
        toVersion: "0.3.5",
        startedAt: Date.now() - 60_000,
        finishedAt: Date.now(),
      },
    });
    await render();
    expect(text()).toContain("updated itself to 0.3.5");
    expect(button("See what's new")).toBeDefined();
  });

  it("says calmly when an automatic update was rolled back", async () => {
    view = make({
      available: false,
      run: {
        id: "a2",
        phase: "rolled_back",
        auto: true,
        from: "a",
        fromVersion: "0.3.1",
        toVersion: "0.3.5",
        startedAt: 1,
        finishedAt: 2,
      },
    });
    await render();
    expect(text()).toContain("went back to 0.3.1");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps one toast id and updates it in place through the update", async () => {
    await render();
    const run = (phase: "building" | "restarting" | "done") => ({
      id: "r",
      phase,
      auto: true,
      from: "a",
      fromVersion: "0.3.1",
      toVersion: "0.3.5",
      startedAt: Date.now(),
      finishedAt: phase === "done" ? Date.now() : undefined,
    });
    for (const phase of ["building", "restarting", "done"] as const) {
      view = make({ available: false, run: run(phase) });
      await render();
    }
    expect(text()).toContain("updated itself to 0.3.5");
    expect(new Set(custom.mock.calls.map((c) => c[1].id))).toEqual(
      new Set(["agentos-update"])
    );
    expect(shown.size).toBe(1);
  });

  it("auto-dismisses the updated note after a few seconds", async () => {
    view = make({
      available: false,
      run: {
        id: "a1",
        phase: "done",
        auto: true,
        from: "a",
        fromVersion: "0.3.1",
        toVersion: "0.3.5",
        startedAt: 1,
        finishedAt: Date.now(),
      },
    });
    await render();
    const opts = custom.mock.calls.at(-1)![1];
    expect(opts.duration).toBeGreaterThan(0);
    expect(opts.duration).toBeLessThanOrEqual(10_000);
    await act(async () => (opts.onAutoClose as () => void)());
    expect(text()).toBe("");
    expect(localStorage.getItem("agentos.update.dismissedRun")).toBe("a1");
  });

  it("closing a running toast hides it without cancelling the update", async () => {
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
    await act(async () => button("Dismiss")!.click());
    expect(text()).toBe("");
    view = make({
      run: {
        id: "r",
        phase: "failed",
        from: "a",
        fromVersion: "0.3.1",
        toVersion: "0.3.5",
        startedAt: 1,
        error: "boom",
      },
    });
    await render();
    expect(text()).toContain("boom");
  });

  it("sits top-center on phones and bottom-right on desktop", async () => {
    await render();
    expect(custom.mock.calls.at(-1)![1].position).toBe("bottom-right");
    desktopMatches = false;
    await act(async () => root.unmount());
    root = createRoot(host);
    await render();
    desktopMatches = true;
    expect(custom.mock.calls.at(-1)![1].position).toBe("top-center");
  });
});
