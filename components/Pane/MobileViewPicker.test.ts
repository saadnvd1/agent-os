import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MobileViewPicker, mobileViews } from "./MobileViewPicker";

// Radix dispatches CustomEvents; the node global is not jsdom's.
Object.defineProperty(globalThis, "CustomEvent", {
  value: (window as unknown as { CustomEvent: unknown }).CustomEvent,
  configurable: true,
});

const all = {
  isLocalSession: true,
  showGit: true,
  hasLog: true,
};

describe("mobileViews", () => {
  it("lists every view, Artifacts included", () => {
    expect(mobileViews(all).map((v) => v.label)).toEqual([
      "Chat",
      "Files",
      "Git",
      "Artifacts",
      "Log",
    ]);
  });

  it("hides views that do not apply", () => {
    expect(
      mobileViews({
        isLocalSession: false,
        showGit: false,
      }).map((v) => v.label)
    ).toEqual(["Chat", "Artifacts"]);
  });

  it("drops only Git when the folder is not a repo", () => {
    expect(mobileViews({ ...all, showGit: false }).map((v) => v.label)).toEqual(
      ["Chat", "Files", "Artifacts", "Log"]
    );
  });
});

describe("MobileViewPicker", () => {
  async function open(viewMode: "terminal" | "artifacts", onChange = vi.fn()) {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        createElement(MobileViewPicker, {
          ...all,
          viewMode,
          onViewModeChange: onChange,
        })
      );
    });
    const trigger = el.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      trigger.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
      );
    });
    return { trigger, onChange };
  }

  it("shows the current view and lists all views in the menu", async () => {
    const { trigger } = await open("artifacts");
    expect(trigger.textContent).toContain("Artifacts");
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual([
      "Chat",
      "Files",
      "Git",
      "Artifacts",
      "Log",
    ]);
    expect(items[3].getAttribute("aria-current")).toBe("true");
  });

  it("selecting an item calls the view-change handler", async () => {
    const { onChange } = await open("terminal");
    const log = [...document.querySelectorAll('[role="menuitem"]')].find((i) =>
      i.textContent?.startsWith("Log")
    ) as HTMLElement;
    await act(async () => {
      log.click();
    });
    expect(onChange).toHaveBeenCalledWith("log");
  });
});
