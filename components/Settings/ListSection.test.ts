import "@/components/Chat/composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ListSection, ScrollTable } from "./ListSection";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const items = (n: number) => Array.from({ length: n }, (_, i) => `item ${i}`);

async function mount(
  props: Partial<Parameters<typeof ListSection<string>>[0]>
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(ListSection<string>, {
        title: "Things",
        items: [],
        keyOf: (s) => s,
        render: (s) => createElement("span", null, s),
        empty: "Nothing here.",
        ...props,
      })
    )
  );
}
const click = (text: string) =>
  act(async () => {
    [...host.querySelectorAll("button")]
      .find((b) => b.textContent?.includes(text))!
      .click();
  });

describe("ListSection", () => {
  it("shows the empty state and a zero count", async () => {
    await mount({});
    expect(host.textContent).toContain("Nothing here.");
    expect(host.querySelector("h3")!.textContent).toBe("Things0");
  });

  it("shows the count and only the first 10, then Show all", async () => {
    await mount({ items: items(25) });
    expect(host.querySelector("h3")!.textContent).toBe("Things25");
    expect(host.querySelectorAll("li")).toHaveLength(10);
    await click("Show all 25");
    expect(host.querySelectorAll("li")).toHaveLength(25);
    await click("Show fewer");
    expect(host.querySelectorAll("li")).toHaveLength(10);
  });

  it("has no Show all when everything fits", async () => {
    await mount({ items: items(10) });
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });

  it("keeps older items behind their own toggle and counts them", async () => {
    await mount({ items: items(2), older: ["old a", "old b", "old c"] });
    expect(host.querySelector("h3")!.textContent).toBe("Things5");
    expect(host.textContent).not.toContain("old a");
    await click("Older (3)");
    expect(host.textContent).toContain("old c");
  });
});

describe("ScrollTable", () => {
  it("scrolls in its own box", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(ScrollTable, null, "x")));
    expect(host.firstElementChild!.className).toContain("overflow-x-auto");
  });
});
