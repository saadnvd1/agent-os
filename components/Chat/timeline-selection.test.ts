import "./composer/test-dom";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem } from "@/lib/chat/events";
import { groupTimeline } from "@/lib/chat/group";
import { copySelection } from "./copy-selection";
import { TimelineRows } from "./ChatPanel";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const user = (id: string, text: string): ChatItem => ({
  id,
  kind: "user",
  createdAt: 1,
  text,
  tagged: true,
});
const reply = (id: string, text: string, streaming = false): ChatItem => ({
  id,
  kind: "assistant",
  createdAt: 2,
  text,
  streaming,
});

describe("the conversation's rows", () => {
  let host: HTMLElement;
  let root: Root;
  const actions = () => ({ respond: vi.fn() }) as never;
  const show = (items: ChatItem[], a = actions()) =>
    act(() =>
      root.render(
        createElement(TimelineRows, {
          blocks: groupTimeline(items),
          actions: a,
        })
      )
    );
  const rows = () => [...host.querySelectorAll("[data-block]")];

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.getSelection()?.removeAllRanges();
  });

  it("keeps a selection across messages through streaming updates", async () => {
    const items = [
      user("u1", "first"),
      reply("a1", "second", true),
      user("u2", "third"),
    ];
    await show(items);
    const [r1, , r3] = rows();
    const range = document.createRange();
    range.setStart(r1, 0);
    range.setEnd(r3, r3.childNodes.length);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);

    await show([
      items[0],
      reply("a1", "second, and more words streamed in", true),
      items[2],
      reply("a2", "a new reply at the end", true),
    ]);
    await show(
      [
        items[0],
        reply("a1", "second, and more words streamed in", false),
        items[2],
        reply("a2", "a new reply at the end, done", false),
      ],
      actions()
    );

    const after = rows();
    expect(after).toHaveLength(4);
    expect(after[0]).toBe(r1);
    expect(after[2]).toBe(r3);
    expect(r1.isConnected && r3.isConnected).toBe(true);
    expect(after.map((r) => r.getAttribute("data-block"))).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
    ]);
    const sel = document.getSelection()!;
    expect(sel.rangeCount).toBe(1);
    expect(sel.isCollapsed).toBe(false);
    expect(sel.getRangeAt(0).startContainer).toBe(r1);
    expect(sel.getRangeAt(0).endContainer).toBe(r3);
  });

  describe("copying", () => {
    const copy = (items: ChatItem[]) => {
      const data: Record<string, string> = {};
      const e = {
        currentTarget: host,
        clipboardData: { setData: (t: string, v: string) => (data[t] = v) },
        preventDefault: vi.fn(),
      };
      copySelection(e as never, new Map(items.map((i) => [i.id, i])));
      return { data, prevented: e.preventDefault.mock.calls.length > 0 };
    };

    it("gives speakers and blank lines across messages, from their source", async () => {
      const items = [
        user("u1", "fix `the` bug"),
        reply("a1", "Done.\n\n- one\n- two"),
        user("u2", "thanks"),
      ];
      await show(items);
      const [r1, , r3] = rows();
      const range = document.createRange();
      range.selectNodeContents(host);
      range.setStart(r1, 0);
      range.setEnd(r3, r3.childNodes.length);
      document.getSelection()!.addRange(range);
      const { data, prevented } = copy(items);
      expect(prevented).toBe(true);
      expect(data["text/plain"]).toBe(
        "User:\nfix `the` bug\n\nAssistant:\nDone.\n\n- one\n- two\n\nUser:\nthanks"
      );
    });

    it("leaves a selection inside one message to the browser", async () => {
      const items = [user("u1", "first"), reply("a1", "second words")];
      await show(items);
      const text = rows()[1].querySelector("p")!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 1);
      range.setEnd(text, 4);
      document.getSelection()!.addRange(range);
      expect(copy(items)).toEqual({ data: {}, prevented: false });
    });
  });
});
