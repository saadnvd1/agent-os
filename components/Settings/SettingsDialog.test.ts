import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "@/lib/notifications";
import { settingsUi, settingsUiActions } from "@/stores/settingsUi";

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

// The sections themselves fetch; here only which one shows matters.
const stub = (name: string) =>
  function Stub() {
    return createElement("p", null, `body:${name}`);
  };
vi.mock("@/components/Merge/GlobalMergeSection", () => ({
  GlobalMergeSection: stub("merging"),
}));
vi.mock("@/components/Workspaces", () => ({
  WorkspaceSettings: stub("workspaces"),
}));
vi.mock("@/components/Devices", () => ({ DevicesPanel: stub("devices") }));
vi.mock("@/components/Schedules", () => ({
  SchedulesPanel: stub("schedules"),
}));
vi.mock("./NotificationsSection", () => ({
  NotificationsSection: stub("notifications"),
}));

const { SettingsDialog } = await import("./SettingsDialog");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const browser = {
  settings: defaultSettings,
  permissionGranted: false,
  updateSettings: () => {},
  requestPermission: async () => false,
};

let root: Root;
let host: HTMLElement;

async function mount(url = "/") {
  window.history.replaceState(null, "", url);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(createElement(SettingsDialog, { notifications: browser }))
  );
}

// valtio notifies on a microtask; the address follows after it.
const flush = () => act(async () => {});
const body = () => document.body.textContent ?? "";
const search = () => window.location.search;
const navButton = (label: string) =>
  [
    ...document.querySelectorAll<HTMLButtonElement>(
      'nav[aria-label="Settings sections"] button'
    ),
  ].find((b) => b.textContent?.startsWith(label))!;

beforeEach(() => {
  settingsUi.open = false;
  settingsUi.section = null;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("SettingsDialog", () => {
  it("opens at the section an old entry point asks for", async () => {
    await mount();
    await act(async () => settingsUiActions.open("devices"));
    expect(body()).toContain("body:devices");
    expect(body()).not.toContain("body:merging");
    await flush();
    expect(search()).toBe("?settings=devices");
  });

  it("moves between sections from the list, and the address follows", async () => {
    await mount();
    await act(async () => settingsUiActions.open("merging"));
    await act(async () => navButton("Schedules").click());
    expect(settingsUi.section).toBe("schedules");
    expect(body()).toContain("body:schedules");
    expect(navButton("Schedules").getAttribute("aria-current")).toBe("page");
    await flush();
    expect(search()).toBe("?settings=schedules");
  });

  it("shows the first section beside the list when none is chosen", async () => {
    await mount();
    await act(async () => settingsUiActions.open());
    expect(body()).toContain("body:merging");
    expect(navButton("Merging").getAttribute("aria-current")).toBe("page");
  });

  it("goes back to the list on a phone", async () => {
    await mount();
    await act(async () => settingsUiActions.open("notifications"));
    const back = document.querySelector<HTMLButtonElement>(
      'button[aria-label="All settings"]'
    )!;
    await act(async () => back.click());
    expect(settingsUi).toMatchObject({ open: true, section: null });
    expect(
      document.querySelector('button[aria-label="All settings"]')
    ).toBeNull();
    await flush();
    expect(search()).toBe("?settings");
  });

  it("closes from its own button", async () => {
    await mount();
    await act(async () => settingsUiActions.open("devices"));
    const close = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Close settings"]'
    )!;
    await act(async () => close.click());
    expect(settingsUi.open).toBe(false);
  });

  it("moves focus to what replaced the button pressed", async () => {
    await mount();
    await act(async () => settingsUiActions.open());
    await act(async () => {
      navButton("Devices").focus();
      navButton("Devices").click();
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Devices & access"
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('button[aria-label="All settings"]')!
        .click()
    );
    expect(document.activeElement).toBe(navButton("Devices"));
  });

  it("leaves focus on the list on a wide screen, where both show", async () => {
    window.matchMedia = ((q: string) => ({
      matches: q === "(min-width: 768px)",
    })) as unknown as typeof window.matchMedia;
    try {
      await mount();
      await act(async () => settingsUiActions.open());
      await act(async () => {
        navButton("Schedules").focus();
        navButton("Schedules").click();
      });
      expect(document.activeElement).toBe(navButton("Schedules"));
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it("opens from the address on load, keeping the session", async () => {
    await mount("/?session=s1&settings=workspaces");
    expect(settingsUi).toMatchObject({ open: true, section: "workspaces" });
    expect(body()).toContain("body:workspaces");
  });

  it("drops the section from the address when closed", async () => {
    await mount("/?session=s1&settings=merging");
    await act(async () => settingsUiActions.close());
    await flush();
    expect(search()).toBe("?session=s1");
    expect(body()).not.toContain("body:merging");
  });

  it("follows back and forward", async () => {
    await mount("/?settings=devices");
    window.history.replaceState(null, "", "/?settings=schedules");
    await act(async () =>
      window.dispatchEvent(new window.PopStateEvent("popstate"))
    );
    expect(settingsUi.section).toBe("schedules");
    window.history.replaceState(null, "", "/");
    await act(async () =>
      window.dispatchEvent(new window.PopStateEvent("popstate"))
    );
    expect(settingsUi.open).toBe(false);
  });
});
