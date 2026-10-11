import type { ClipboardEvent } from "react";
import type { ChatItem } from "@/lib/chat/events";
import {
  formatTranscript,
  sourceText,
  speakerOf,
  type TranscriptPart,
} from "@/lib/chat/copy-selection";

// What isn't part of a message's words: buttons, times, and labels that
// only the interface shows.
const SKIP = "button, time, [aria-hidden='true'], [data-copy-skip]";

// Range's own constants, which tests without a browser global don't have.
const START_TO_START = 0;
const END_TO_END = 2;

const covers = (range: Range, el: Element) => {
  const whole = el.ownerDocument.createRange();
  whole.selectNodeContents(el);
  return (
    range.compareBoundaryPoints(START_TO_START, whole) <= 0 &&
    range.compareBoundaryPoints(END_TO_END, whole) >= 0
  );
};

// The part of a message inside the selection, as it reads on screen.
function clippedText(range: Range, el: Element): string {
  const doc = el.ownerDocument;
  const whole = doc.createRange();
  whole.selectNodeContents(el);
  const part = range.cloneRange();
  if (part.compareBoundaryPoints(START_TO_START, whole) < 0)
    part.setStart(whole.startContainer, whole.startOffset);
  if (part.compareBoundaryPoints(END_TO_END, whole) > 0)
    part.setEnd(whole.endContainer, whole.endOffset);
  const holder = doc.createElement("div");
  holder.style.cssText =
    "position:fixed;left:-9999px;top:0;width:600px;white-space:pre-wrap";
  holder.append(part.cloneContents());
  for (const skip of holder.querySelectorAll(SKIP)) skip.remove();
  doc.body.append(holder);
  const text = holder.innerText ?? holder.textContent ?? "";
  holder.remove();
  return text.replace(/\n{3,}/g, "\n\n");
}

/**
 * Copy across several messages as a transcript: who said what, a blank line
 * between. A selection inside one message is left to the browser, which
 * already copies that cleanly.
 */
export function copySelection(
  e: ClipboardEvent,
  itemsById: ReadonlyMap<string, ChatItem>
) {
  const root = e.currentTarget as Element;
  const sel = root.ownerDocument.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return;
  const ranges = Array.from({ length: sel.rangeCount }, (_, i) =>
    sel.getRangeAt(i)
  );
  const parts: (TranscriptPart & { el: Element })[] = [];
  for (const el of root.querySelectorAll("[data-item]")) {
    const item = itemsById.get(el.getAttribute("data-item") ?? "");
    const speaker = item && speakerOf(item);
    if (!item || !speaker) continue;
    const hit = ranges.filter((r) => r.intersectsNode(el));
    if (!hit.length) continue;
    const whole = hit.some((r) => covers(r, el));
    parts.push({
      el,
      speaker,
      text: whole
        ? sourceText(item)
        : hit.map((r) => clippedText(r, el)).join("\n"),
    });
  }
  if (parts.length < 2) return;
  e.clipboardData.setData("text/plain", formatTranscript(parts));
  e.preventDefault();
}
