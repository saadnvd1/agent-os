import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it } from "vitest";
import { placeQuote, quotePick, rangeText } from "./quote-selection";

// The suite's setup needs node, so the DOM is built here.
const { window } = new JSDOM("<!doctype html><body></body>");
const { document } = window;

// Two replies with a message from the user between them, then what follows
// the last reply: its copy button and the end of the list.
function chat() {
  document.body.innerHTML = `
    <div id="root">
      <div id="a1"><div data-quotable><p>First reply.</p><p>Its last line.</p></div><button aria-label="Copy message"></button></div>
      <div id="u2"><p>A question</p></div>
      <div id="a2"><div data-quotable><p>Opening.</p><p>The very last line of the chat.</p></div><button aria-label="Copy message"></button></div>
      <div id="tail"></div>
    </div>
    <textarea id="composer">draft</textarea>`;
  return document.getElementById("root")!;
}

const text = (sel: string, nth = 0) =>
  document.querySelectorAll(sel)[nth].firstChild as Text;

function select(start: [Node, number], end: [Node, number]): Selection {
  const sel = window.getSelection()!;
  const r = document.createRange();
  r.setStart(...start);
  r.setEnd(...end);
  sel.removeAllRanges();
  sel.addRange(r);
  return sel;
}

describe("quotePick", () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = chat();
  });

  const last = () => text("#a2 p", 1);

  it("quotes a word on the last line", () => {
    const sel = select([last(), 4], [last(), 8]);
    expect(quotePick(sel, root)?.text).toBe("very");
  });

  it("quotes the whole last line by triple-click, which ends past the reply", () => {
    // Chrome ends a triple-clicked paragraph at the start of what follows
    // it: here the copy button, outside the reply.
    const button = document.querySelector("#a2 button")!;
    const sel = select([last(), 0], [button, 0]);
    expect(quotePick(sel, root)?.text).toBe("The very last line of the chat.");
  });

  it("quotes the whole last line dragged to its end and past it", () => {
    const toEnd = select([last(), 0], [last(), last().length]);
    expect(quotePick(toEnd, root)?.text).toBe(
      "The very last line of the chat."
    );
    const tail = document.getElementById("tail")!;
    const past = select([last(), 0], [tail, 0]);
    expect(quotePick(past, root)?.text).toBe("The very last line of the chat.");
    const intoComposer = select([last(), 0], [document.body, 2]);
    expect(quotePick(intoComposer, root)?.text).toBe(
      "The very last line of the chat."
    );
  });

  it("quotes the last line of a reply that isn't the last", () => {
    const line = text("#a1 p", 1);
    const question = text("#u2 p");
    const sel = select([line, 0], [question, 0]);
    expect(quotePick(sel, root)?.text).toBe("Its last line.");
  });

  it("leaves out the user's text when a selection runs into it", () => {
    const into = select([text("#a1 p", 1), 0], [text("#u2 p"), 6]);
    const pick = quotePick(into, root)!;
    expect(pick.text).toBe("Its last line.");
    expect(pick.ranges).toHaveLength(1);
    const from = select([text("#u2 p"), 2], [text("#a2 p", 0), 4]);
    expect(quotePick(from, root)?.text).toBe("Open");
  });

  it("quotes only the replies' text when a selection spans two", () => {
    const sel = select([text("#a1 p", 1), 4], [text("#a2 p", 0), 7]);
    const pick = quotePick(sel, root)!;
    expect(pick.text).toBe("last line.\n\nOpening");
    expect(pick.ranges).toHaveLength(2);
  });

  it("keeps paragraphs on their own lines across replies", () => {
    // A lone reply uses the browser's own text (in jsdom, Range.toString);
    // across replies each part is laid out by block.
    const sel = select([text("#a1 p", 0), 0], [text("#a2 p", 0), 3]);
    expect(quotePick(sel, root)?.text).toBe(
      "First reply.\n\nIts last line.\n\nOpe"
    );
  });

  it("ignores selections outside replies", () => {
    const q = text("#u2 p");
    expect(quotePick(select([q, 0], [q, 5]), root)).toBeNull();
    const tail = document.getElementById("tail")!;
    expect(quotePick(select([tail, 0], [document.body, 2]), root)).toBeNull();
  });

  it("ignores a selection that only touches a reply's edge", () => {
    // Ends at the start of the next reply, taking none of its text.
    const q = text("#u2 p");
    const next = document.querySelector("#a2 [data-quotable]")!;
    expect(quotePick(select([q, 0], [next, 0]), root)).toBeNull();
  });

  it("ignores a collapsed selection", () => {
    expect(quotePick(select([last(), 3], [last(), 3]), root)).toBeNull();
  });
});

describe("rangeText", () => {
  it("puts list items on single lines and paragraphs apart", () => {
    document.body.innerHTML =
      "<div id=x><p>Intro</p><ul><li>one</li><li>two</li></ul><p>End<br>line</p></div>";
    const r = document.createRange();
    r.selectNodeContents(document.getElementById("x")!);
    expect(rangeText(r)).toBe("Intro\n\none\ntwo\n\nEnd\nline");
  });
});

describe("placeQuote", () => {
  const view = { top: 100, bottom: 700, left: 0, right: 800 };

  it("floats above the selection when there's room", () => {
    expect(
      placeQuote({ top: 680, bottom: 698, left: 100, right: 300 }, view)
    ).toEqual({ x: 200, y: 680, side: "above" });
  });

  it("drops below when the selection is at the top of the chat", () => {
    expect(
      placeQuote({ top: 110, bottom: 130, left: 100, right: 300 }, view)
    ).toEqual({ x: 200, y: 130, side: "below" });
  });

  it("stays above the composer for a tall selection scrolled past the top", () => {
    expect(
      placeQuote({ top: 20, bottom: 900, left: 100, right: 300 }, view)
    ).toEqual({ x: 200, y: 652, side: "below" });
  });

  it("stays inside the chat's sides", () => {
    expect(
      placeQuote({ top: 400, bottom: 420, left: 0, right: 10 }, view)?.x
    ).toBe(60);
  });

  it("hides while the selection is scrolled out of view", () => {
    expect(
      placeQuote({ top: 720, bottom: 740, left: 0, right: 10 }, view)
    ).toBeNull();
    expect(
      placeQuote({ top: 20, bottom: 80, left: 0, right: 10 }, view)
    ).toBeNull();
  });
});
