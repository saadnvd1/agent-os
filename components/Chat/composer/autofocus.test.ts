import "./test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import {
  DIALOG_WAIT_MS,
  focusComposerInGesture,
  focusVerdict,
  useFocusOnShow,
} from "./autofocus";
import { isPhoneLayout } from "./layout";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// A page like the app's: a sidebar with search, and a chat panel holding a
// message with a button and the composer.
let editorDom: HTMLElement;
let search: HTMLInputElement;
let sidebarRow: HTMLButtonElement;
let messageButton: HTMLButtonElement;
let message: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `
    <nav>
      <input id="search" />
      <button id="row">Session</button>
    </nav>
    <div data-composer-scope tabindex="-1">
      <p id="message">Some reply <button id="copy">Copy</button></p>
      <div class="chat-composer"><div id="editor" contenteditable="true"></div></div>
    </div>`;
  editorDom = document.getElementById("editor")!;
  search = document.getElementById("search") as HTMLInputElement;
  sidebarRow = document.getElementById("row") as HTMLButtonElement;
  messageButton = document.getElementById("copy") as HTMLButtonElement;
  message = document.getElementById("message")!;
  document.getSelection()?.removeAllRanges();
});

function stubMedia(matches: Record<string, boolean>) {
  window.matchMedia = ((q: string) => ({
    matches: matches[q] ?? false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as never;
}

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
  document.querySelectorAll("[data-composer-proxy]").forEach((e) => e.remove());
});

describe("focusComposerInGesture", () => {
  const chat = { view: "chat" };
  let paneA: HTMLElement;
  let paneB: HTMLElement;
  let hostEl: HTMLElement;
  const panelOf = (pane: HTMLElement) =>
    pane.querySelector("[data-composer-scope]")!;

  // Two panes, each with a chat panel and composer. jsdom has no layout, so
  // a hidden tab is a panel marked data-hidden that reports no client rects.
  beforeEach(() => {
    hostEl = document.createElement("div");
    hostEl.innerHTML = ["a", "b"]
      .map(
        (id) =>
          `<div data-pane-id="${id}"><div data-composer-scope tabindex="-1"><div class="chat-composer"><div id="ed-${id}" contenteditable="true"></div></div></div></div>`
      )
      .join("");
    document.body.append(hostEl);
    paneA = hostEl.querySelector('[data-pane-id="a"]')!;
    paneB = hostEl.querySelector('[data-pane-id="b"]')!;
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
      function (this: HTMLElement) {
        return this.closest("[data-hidden]") ? ([] as never) : ([{}] as never);
      } as never
    );
    // The page's own composer is gone: only the panes have one.
    editorDom.parentElement!.remove();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    hostEl.remove();
  });

  it("focuses the composer in the target pane, not another pane's", () => {
    stubMedia({ "(pointer: coarse)": true });
    sidebarRow.focus();
    focusComposerInGesture(paneB, chat);
    expect(document.activeElement?.id).toBe("ed-b");
    sidebarRow.focus();
    focusComposerInGesture(paneA, chat);
    expect(document.activeElement?.id).toBe("ed-a");
  });

  it("skips a hidden tab's composer and falls back to the proxy", () => {
    stubMedia({});
    panelOf(paneB).setAttribute("data-hidden", "");
    sidebarRow.focus();
    focusComposerInGesture(paneB, chat);
    expect(document.activeElement?.hasAttribute("data-composer-proxy")).toBe(
      true
    );
    expect(document.activeElement?.id).not.toBe("ed-b");
  });

  it("never for a terminal session", () => {
    stubMedia({});
    sidebarRow.focus();
    focusComposerInGesture(paneB, { view: "terminal" });
    expect(document.activeElement).toBe(sidebarRow);
    expect(document.querySelector("[data-composer-proxy]")).toBeNull();
  });

  it("does nothing in the phone layout", () => {
    stubMedia({ "(max-width: 767px)": true });
    sidebarRow.focus();
    focusComposerInGesture(paneB, chat);
    expect(document.activeElement).toBe(sidebarRow);
    expect(document.querySelector("[data-composer-proxy]")).toBeNull();
  });

  it("leaves someone typing elsewhere, or working in the panel, alone", () => {
    stubMedia({});
    search.focus();
    focusComposerInGesture(paneB, chat);
    expect(document.activeElement).toBe(search);
    // Focus inside a panel with no composer showing keeps the proxy away too.
    const inPanel = document.createElement("button");
    panelOf(paneB).append(inPanel);
    panelOf(paneB).querySelector(".chat-composer")!.remove();
    inPanel.focus();
    focusComposerInGesture(paneB, chat);
    expect(document.activeElement).toBe(inPanel);
    expect(document.querySelector("[data-composer-proxy]")).toBeNull();
  });

  it("the hook hands the proxy's focus to the editor and drops the proxy", async () => {
    stubMedia({});
    panelOf(paneB).setAttribute("data-hidden", "");
    sidebarRow.focus();
    focusComposerInGesture(paneB, chat);
    const proxy = document.querySelector("[data-composer-proxy]")!;
    const dom = hostEl.querySelector<HTMLElement>("#ed-a")!;
    const editor = {
      view: { dom },
      commands: { focus: () => dom.focus() },
      isEditable: true,
      on: () => {},
      off: () => {},
    } as never;
    function Probe() {
      useFocusOnShow(editor, "a", false);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(() => root.render(createElement(Probe)));
    expect(document.activeElement).toBe(dom);
    expect(proxy.isConnected).toBe(false);
    await act(() => root.unmount());
  });
});

describe("focusVerdict", () => {
  it("takes the caret from nothing, a sidebar row, or itself", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(focusVerdict(editorDom, false)).toBe("take");
    sidebarRow.focus();
    expect(focusVerdict(editorDom, false)).toBe("take");
    editorDom.focus();
    expect(focusVerdict(editorDom, false)).toBe("take");
  });

  it("never in the phone layout, where it raises the keyboard", () => {
    sidebarRow.focus();
    expect(focusVerdict(editorDom, true)).toBe("leave");
  });

  it("does in the desktop layout on a coarse pointer (iPad)", () => {
    stubMedia({ "(pointer: coarse)": true, "(max-width: 767px)": false });
    sidebarRow.focus();
    expect(focusVerdict(editorDom, isPhoneLayout())).toBe("take");
  });

  it("leaves someone typing in another field (search, rename) alone", () => {
    search.focus();
    expect(focusVerdict(editorDom, false)).toBe("leave");
    search.blur();
    const rename = document.createElement("span");
    rename.setAttribute("contenteditable", "true");
    document.querySelector("nav")!.append(rename);
    rename.focus();
    expect(document.activeElement).toBe(rename);
    expect(focusVerdict(editorDom, false)).toBe("leave");
  });

  it("waits while a dialog, menu or settings is open on top", () => {
    for (const html of [
      '<div role="dialog" data-state="open"></div>',
      '<div role="alertdialog" data-state="open"></div>',
      '<div role="menu" data-state="open"></div>',
      "<dialog open></dialog>",
    ]) {
      document.body.insertAdjacentHTML("beforeend", html);
      expect(focusVerdict(editorDom, false)).toBe("wait");
      document.body.lastElementChild!.remove();
    }
    // A dialog on its way out still holds focus until it's gone.
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="dialog" data-state="closed"><input id="palette-search" /></div>'
    );
    const paletteSearch = document.getElementById("palette-search")!;
    paletteSearch.focus();
    expect(focusVerdict(editorDom, false)).toBe("wait");
    paletteSearch.parentElement!.remove();
    expect(focusVerdict(editorDom, false)).toBe("take");
  });

  it("keeps a text selection the reader made", () => {
    const range = document.createRange();
    range.selectNodeContents(message.firstChild!);
    document.getSelection()!.addRange(range);
    expect(focusVerdict(editorDom, false)).toBe("leave");
  });

  it("a selection inside the composer itself doesn't hold it back", () => {
    editorDom.textContent = "draft";
    const range = document.createRange();
    range.selectNodeContents(editorDom.firstChild!);
    document.getSelection()!.addRange(range);
    expect(focusVerdict(editorDom, false)).toBe("take");
  });

  it("leaves focus the user put inside the panel itself", () => {
    messageButton.focus();
    expect(focusVerdict(editorDom, false)).toBe("leave");
  });
});

describe("useFocusOnShow", () => {
  let root: Root;
  let focus: ReturnType<typeof vi.fn>;
  let editor: Editor;
  let editable: boolean;

  beforeEach(() => {
    editable = true;
    // Focuses the element for real, so later decisions see where focus is.
    focus = vi.fn(() => editorDom.focus());
    const blur: (() => void)[] = [];
    editorDom.addEventListener("blur", () => blur.forEach((f) => f()));
    editor = {
      view: { dom: editorDom },
      commands: { focus },
      get isEditable() {
        return editable;
      },
      on: (_: string, f: () => void) => blur.push(f),
      off: (_: string, f: () => void) => blur.splice(blur.indexOf(f), 1),
    } as never;
    root = createRoot(document.createElement("div"));
  });
  afterEach(async () => {
    await act(() => root.unmount());
    vi.useRealTimers();
  });

  function Probe(props: {
    editor: Editor | null;
    focusKey: string | null;
    coarse?: boolean;
    disabled?: boolean;
  }) {
    useFocusOnShow(
      props.editor,
      props.focusKey,
      props.coarse ?? false,
      props.disabled ?? false
    );
    return null;
  }
  const render = (props: Parameters<typeof Probe>[0]) =>
    act(() => root.render(createElement(Probe, props)));

  it("focuses once per session shown, without scrolling", async () => {
    await render({ editor, focusKey: "a" });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith("end", { scrollIntoView: false });
    // A background re-render of the same session takes nothing.
    await render({ editor, focusKey: "a" });
    expect(focus).toHaveBeenCalledTimes(1);
    await render({ editor, focusKey: "b" });
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("waits for the editor to load", async () => {
    await render({ editor: null, focusKey: "a" });
    expect(focus).not.toHaveBeenCalled();
    await render({ editor, focusKey: "a" });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("focuses again when the same session is shown again", async () => {
    await render({ editor, focusKey: "a" });
    await render({ editor, focusKey: null });
    await render({ editor, focusKey: "a" });
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("does not take the caret from the search box, or on a phone", async () => {
    search.focus();
    await render({ editor, focusKey: "a" });
    sidebarRow.focus();
    await render({ editor, focusKey: "b", coarse: true });
    expect(focus).not.toHaveBeenCalled();
  });

  it("gets the caret back after the reconnect that follows a switch", async () => {
    await render({ editor, focusKey: "a" });
    // Disabling the editor blurs it.
    editable = false;
    editorDom.blur();
    await render({ editor, focusKey: "a", disabled: true });
    editable = true;
    await render({ editor, focusKey: "a" });
    expect(focus).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenLastCalledWith(null, { scrollIntoView: false });
  });

  it("does not take it back once the user has moved on", async () => {
    await render({ editor, focusKey: "a" });
    search.focus();
    await render({ editor, focusKey: "a", disabled: true });
    await render({ editor, focusKey: "a" });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("leaves the caret out once the user clicked out of the composer", async () => {
    await render({ editor, focusKey: "a" });
    // Clicked on something that takes no focus: the editor blurs while
    // editable, and focus falls to the body.
    editorDom.blur();
    await render({ editor, focusKey: "a", disabled: true });
    await render({ editor, focusKey: "a" });
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("opened from a dialog (⌘K), focuses once it has closed", async () => {
    vi.useFakeTimers();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="palette" role="dialog" data-state="open"></div>'
    );
    await render({ editor, focusKey: "a" });
    expect(focus).not.toHaveBeenCalled();
    document.getElementById("palette")!.remove();
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(focus).toHaveBeenCalledWith("end", { scrollIntoView: false });
  });

  it("lets a closing dialog hand focus back before deciding", async () => {
    vi.useFakeTimers();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="palette" role="dialog" data-state="open"></div>'
    );
    await render({ editor, focusKey: "a" });
    // The dialog goes just before the hook's next look (at 50ms), and hands
    // focus back to the search box on a timer of its own that is still
    // pending when the hook looks, as Radix's does.
    setTimeout(() => {
      document.getElementById("palette")!.remove();
      setTimeout(() => search.focus(), 1);
    }, 49);
    await act(() => vi.advanceTimersByTimeAsync(49));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(document.activeElement).toBe(search);
    expect(focus).not.toHaveBeenCalled();
  });

  it("gives up on a dialog that stays open", async () => {
    vi.useFakeTimers();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div id="settings" role="dialog" data-state="open"></div>'
    );
    await render({ editor, focusKey: "a" });
    await act(() => vi.advanceTimersByTimeAsync(DIALOG_WAIT_MS + 100));
    document.getElementById("settings")!.remove();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(focus).not.toHaveBeenCalled();
  });
});
