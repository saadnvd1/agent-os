import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showGitToggle } from "./git-visibility";
import { PaneViewToggle } from "./PaneViewToggle";

// Radix tooltips need a real browser; plain elements show what's rendered.
vi.mock("@/components/ui/tooltip", async () => {
  const { createElement: h } = await import("react");
  const part = (props: { children?: unknown }) =>
    h("span", null, props.children as never);
  return {
    Tooltip: part,
    TooltipTrigger: part,
    TooltipContent: () => null,
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("showGitToggle", () => {
  it("shows for a local repo", () => {
    expect(showGitToggle(true, true)).toBe(true);
  });
  it("keeps showing while the check is unknown", () => {
    expect(showGitToggle(true, undefined)).toBe(true);
  });
  it("hides outside a repo", () => {
    expect(showGitToggle(true, false)).toBe(false);
  });
  it("hides for a remote session", () => {
    expect(showGitToggle(false, true)).toBe(false);
    expect(showGitToggle(false, undefined)).toBe(false);
  });
});

describe("PaneViewToggle", () => {
  let host: HTMLElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = (showGit: boolean) =>
    act(() => {
      root.render(
        createElement(PaneViewToggle, {
          viewMode: "terminal",
          isLocalSession: true,
          showGit,
          isConductor: false,
          workerCount: 0,
          gitDrawerOpen: false,
          shellDrawerOpen: false,
          onViewModeChange: () => {},
          onGitDrawerToggle: () => {},
          onShellDrawerToggle: () => {},
        })
      );
    });
  const has = (label: string) =>
    !!host.querySelector(`[aria-label="${label}"]`);

  it("omits Git outside a repo but keeps Files and Shell", () => {
    render(false);
    expect(has("Git")).toBe(false);
    expect(has("Files")).toBe(true);
    expect(has("Shell")).toBe(true);
  });
  it("shows Git in a repo", () => {
    render(true);
    expect(has("Git")).toBe(true);
  });
});
