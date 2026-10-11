import "./test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { DIALOG_WAIT_MS, focusVerdict, useFocusOnShow } from "./autofocus";

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

describe("focusVerdict", () => {
  it("takes the caret from nothing, a sidebar row, or itself", () => {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(focusVerdict(editorDom, false)).toBe("take");
    sidebarRow.focus();
    expect(focusVerdict(editorDom, false)).toBe("take");
    editorDom.focus();
    expect(focusVerdict(editorDom, false)).toBe("take");
  });

  it("never on a touch screen, where it raises the keyboard", () => {
    sidebarRow.focus();
    expect(focusVerdict(editorDom, true)).toBe("leave");
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
