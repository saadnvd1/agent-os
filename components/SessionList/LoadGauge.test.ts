import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { healthKeys } from "@/data/health";
import { loadKeys } from "@/data/load";
import type { LoadView } from "@/lib/load/monitor";
import { settingsUi } from "@/stores/settingsUi";
import { LoadGauge } from "./LoadGauge";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  settingsUi.open = false;
  settingsUi.section = null;
  vi.stubGlobal("fetch", () => new Promise(() => {}));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const view = (level: LoadView["level"]): LoadView => ({
  level,
  load1: 1,
  cores: 8,
  memUsedPct: 30,
  pressure: "normal",
  top: [],
  unattributed: [],
  sessions: {},
});

function render(
  level: LoadView["level"],
  health: { open: number; needsYou: number }
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(loadKeys.all, view(level));
  qc.setQueryData(healthKeys.count(), health);
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(LoadGauge)
      )
    )
  );
}

describe("LoadGauge", () => {
  it("renders one dot, never a separate health dot", () => {
    render("green", { open: 1, needsYou: 0 });
    expect(host.querySelectorAll("button")).toHaveLength(1);
    expect(host.querySelector("[data-health-dot]")).toBeNull();
  });

  it("opens Settings → Health when an issue is open", () => {
    render("green", { open: 1, needsYou: 0 });
    const b = host.querySelector("button")!;
    expect(b.dataset.statusDot).toBe("amber");
    expect(b.getAttribute("aria-label")).toBe(
      "Load normal · 1 health issue open"
    );
    act(() => b.click());
    expect(settingsUi.open).toBe(true);
    expect(settingsUi.section).toBe("health");
  });

  it("keeps the load popover when nothing is open", () => {
    render("red", { open: 0, needsYou: 0 });
    const b = host.querySelector("button")!;
    expect(b.dataset.statusDot).toBe("red");
    expect(b.dataset.opens).toBe("load");
    expect(b.getAttribute("aria-haspopup")).toBe("menu");
  });
});
