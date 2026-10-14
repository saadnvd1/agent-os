import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Where a menu opens (flip, shift, the 8px gap) is floating-ui's job inside
// Radix, and Radix can't mount in the suite's fake DOM. What is ours is that
// every menu surface hands its height to the room left on screen and scrolls
// past it instead of clipping, so that is what this pins. The geometry itself
// is checked in a browser.
const surfaces = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("popover-surface"));

describe.each([
  ["./dropdown-menu.tsx", "dropdown-menu"],
  ["./context-menu.tsx", "context-menu"],
])("%s", (file, name) => {
  const lines = surfaces(file);

  it("has a menu and a submenu surface", () => {
    expect(lines).toHaveLength(2);
  });

  it.each([0, 1])("caps surface %i to the space available and scrolls", (i) => {
    expect(lines[i]).toContain(
      `max-h-(--radix-${name}-content-available-height)`
    );
    expect(lines[i]).toContain("overflow-y-auto");
    expect(lines[i]).not.toContain("overflow-hidden");
  });

  it("keeps menus off the window edge", () => {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(src.match(/collisionPadding/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
